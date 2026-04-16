import type { TabId, LeaderMessage } from './types';
import type { Transport } from './transport';
import { LeaderTransport, FollowerTransport } from './transport';

const HEARTBEAT_INTERVAL = 1000;
const HEARTBEAT_TIMEOUT = 3000;

interface ElectionResult {
  transport: Transport;
  cleanup: () => void;
}

/**
 * リーダー選出でマルチタブ対応の Transport を作成する。
 *
 * - Web Locks API でリーダーを1つだけ選出
 * - リーダー: Worker を起動して直接操作
 * - フォロワー: BroadcastChannel 経由でリーダーに中継
 * - リーダーが死んだらフォロワーが自動昇格
 */
export function electLeader(
  dbName: string,
  createWorker: () => Worker
): Promise<ElectionResult> {
  const tabId: TabId = crypto.randomUUID();
  const lockName = `lona-q-leader:${dbName}`;
  const channel = new BroadcastChannel(`lona-q:${dbName}`);
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let unloadHandler: (() => void) | null = null;
  let followerListener: ((e: MessageEvent<LeaderMessage>) => void) | null = null;

  let currentTransport: Transport | null = null;
  let onTransportReady: ((t: Transport) => void) | null = null;

  function becomeLeader(): Transport {
    const worker = createWorker();
    const transport = new LeaderTransport(worker, channel);
    console.log(`[lona-q] role: leader (tab=${tabId.slice(0, 8)})`);

    // heartbeat を全タブにブロードキャスト
    heartbeatTimer = setInterval(() => {
      channel.postMessage({ type: 'heartbeat', leaderId: tabId } satisfies LeaderMessage);
    }, HEARTBEAT_INTERVAL);

    // リーダー準備完了を通知
    channel.postMessage({ type: 'leader-ready', leaderId: tabId } satisfies LeaderMessage);

    // タブを閉じる時にリーダー交代を通知（参照を保持して cleanup で解除）
    unloadHandler = () => {
      channel.postMessage({ type: 'leader-closing', leaderId: tabId } satisfies LeaderMessage);
    };
    window.addEventListener('beforeunload', unloadHandler);

    return transport;
  }

  function becomeFollower(): Transport {
    const transport = new FollowerTransport(channel, tabId);
    console.log(`[lona-q] role: follower (tab=${tabId.slice(0, 8)})`);

    function resetWatchdog() {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => attemptPromotion(), HEARTBEAT_TIMEOUT);
    }

    // heartbeat 監視リスナー（参照を保持して cleanup / 昇格時に解除）
    followerListener = (e: MessageEvent<LeaderMessage>) => {
      if (e.data.type === 'heartbeat' || e.data.type === 'leader-ready') {
        resetWatchdog();
      }
      if (e.data.type === 'leader-closing') {
        attemptPromotion();
      }
    };
    channel.addEventListener('message', followerListener);
    resetWatchdog();

    async function attemptPromotion() {
      if (watchdogTimer) clearTimeout(watchdogTimer);

      navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resetWatchdog();
          return;
        }

        console.log(`[lona-q] promoted to leader (tab=${tabId.slice(0, 8)})`);

        // フォロワー用リスナーを解除
        if (followerListener) {
          channel.removeEventListener('message', followerListener);
          followerListener = null;
        }

        // 新リーダーとしてトランスポートを差し替え
        const newTransport = becomeLeader();
        currentTransport = newTransport;
        onTransportReady?.(newTransport);

        // ロックを保持し続ける
        await new Promise(() => {});
      });
    }

    return transport;
  }

  // 全リソースを解放する共通クリーンアップ
  function createCleanup(): () => void {
    return () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (followerListener) channel.removeEventListener('message', followerListener);
      if (unloadHandler) window.removeEventListener('beforeunload', unloadHandler);
      channel.close();
    };
  }

  return new Promise<ElectionResult>((resolve) => {
    navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
      if (lock) {
        const transport = becomeLeader();
        currentTransport = transport;
        resolve({ transport, cleanup: createCleanup() });
        await new Promise(() => {});
      } else {
        const transport = becomeFollower();
        currentTransport = transport;
        resolve({ transport, cleanup: createCleanup() });
      }
    });
  });
}
