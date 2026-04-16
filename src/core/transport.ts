import type { TabId, WorkerRequest, WorkerResponse, LeaderMessage } from './types';

/**
 * Transport: Worker と BroadcastChannel の両方を同じインターフェースで扱う抽象層。
 * LonaQDatabaseImpl はこのインターフェースだけを知っていればよい。
 */
export interface Transport {
  postMessage(msg: Record<string, unknown>, transfer?: Transferable[]): void;
  set onmessage(handler: ((event: { data: WorkerResponse }) => void) | null);
  close(): void;
}

/**
 * LeaderTransport: リーダータブ用。
 * - Worker を直接ラップ（ローカルクエリ用）
 * - BroadcastChannel からフォロワーのリクエストを受信 → Worker に中継 → 応答を返す
 * - Worker の change 通知を BroadcastChannel にブロードキャスト
 */
export class LeaderTransport implements Transport {
  private worker: Worker;
  private channel: BroadcastChannel;
  private localHandler: ((event: { data: WorkerResponse }) => void) | null = null;
  private channelListener: (e: MessageEvent<LeaderMessage>) => void;

  private relayCounter = 0;
  private relayMap = new Map<string, { tabId: TabId; originalId: string }>();

  constructor(worker: Worker, channel: BroadcastChannel) {
    this.worker = worker;
    this.channel = channel;

    // Worker からのレスポンスを処理
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const data = e.data;

      // change 通知 → ローカル + 全フォロワーにブロードキャスト
      if (data.type === 'change') {
        this.localHandler?.({ data });
        this.channel.postMessage({ type: 'change', tables: data.tables } satisfies LeaderMessage);
        return;
      }

      // リレー応答かローカル応答かを判定
      const id = (data as { id: string }).id;
      const relay = this.relayMap.get(id);

      if (relay) {
        // フォロワーへの応答: 元の ID に戻して BroadcastChannel で返す
        this.relayMap.delete(id);
        const payload = { ...data, id: relay.originalId } as WorkerResponse;
        this.channel.postMessage({
          type: 'response',
          tabId: relay.tabId,
          payload,
        } satisfies LeaderMessage);
      } else {
        // ローカルリクエストへの応答
        this.localHandler?.({ data });
      }
    };

    // BroadcastChannel リスナー（close 時に解除するため参照を保持）
    this.channelListener = (e: MessageEvent<LeaderMessage>) => {
      if (e.data.type === 'request') {
        this.handleFollowerRequest(e.data.tabId, e.data.payload);
      }
    };
    this.channel.addEventListener('message', this.channelListener);
  }

  private handleFollowerRequest(tabId: TabId, payload: WorkerRequest) {
    // リーダー側で新しい ID を振り、マッピングを保持
    const relayId = `relay_${++this.relayCounter}`;
    this.relayMap.set(relayId, { tabId, originalId: payload.id });

    // Worker に中継（ID を差し替え）
    const forwarded = { ...payload, id: relayId };
    this.worker.postMessage(forwarded);
  }

  postMessage(msg: Record<string, unknown>, transfer?: Transferable[]): void {
    if (transfer) {
      this.worker.postMessage(msg, transfer);
    } else {
      this.worker.postMessage(msg);
    }
  }

  set onmessage(handler: ((event: { data: WorkerResponse }) => void) | null) {
    this.localHandler = handler;
  }

  close(): void {
    this.channel.removeEventListener('message', this.channelListener);
    this.worker.terminate();
  }
}

/**
 * FollowerTransport: フォロワータブ用。
 * - クエリを BroadcastChannel 経由でリーダーに中継
 * - 自分の tabId 宛の応答だけを受信
 * - change 通知も受信
 */
export class FollowerTransport implements Transport {
  private channel: BroadcastChannel;
  private tabId: TabId;
  private handler: ((event: { data: WorkerResponse }) => void) | null = null;
  private channelListener: (e: MessageEvent<LeaderMessage>) => void;

  constructor(channel: BroadcastChannel, tabId: TabId) {
    this.channel = channel;
    this.tabId = tabId;

    // BroadcastChannel リスナー（close 時に解除するため参照を保持）
    this.channelListener = (e: MessageEvent<LeaderMessage>) => {
      const msg = e.data;

      if (msg.type === 'response' && msg.tabId === this.tabId) {
        this.handler?.({ data: msg.payload });
        return;
      }

      if (msg.type === 'change') {
        this.handler?.({ data: { type: 'change', tables: msg.tables } });
      }
    };
    this.channel.addEventListener('message', this.channelListener);
  }

  postMessage(msg: Record<string, unknown>): void {
    // リクエストを BroadcastChannel でリーダーに送信
    this.channel.postMessage({
      type: 'request',
      tabId: this.tabId,
      payload: msg,
    } satisfies LeaderMessage);
  }

  set onmessage(handler: ((event: { data: WorkerResponse }) => void) | null) {
    this.handler = handler;
  }

  close(): void {
    this.channel.removeEventListener('message', this.channelListener);
  }
}
