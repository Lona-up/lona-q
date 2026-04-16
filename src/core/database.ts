import type {
  WorkerResponse,
  LonaQDatabase,
  LonaQTransaction,
  CreateDBOptions,
} from './types';
import type { Transport } from './transport';
import { LeaderTransport } from './transport';
import { LonaQNotReadyError, LonaQTimeoutError } from './errors';
import { electLeader } from './leader-election';

const DEFAULT_QUERY_TIMEOUT = 10_000;

class LonaQDatabaseImpl implements LonaQDatabase {
  private transport: Transport;
  private counter = 0;
  private pending = new Map<string, {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private changeListeners = new Set<(tables: string[]) => void>();
  private _isReady = false;
  private queryTimeout: number;

  get isReady() {
    return this._isReady;
  }

  constructor(transport: Transport, queryTimeout = DEFAULT_QUERY_TIMEOUT) {
    this.transport = transport;
    this.queryTimeout = queryTimeout;
    this.wireTransport(transport);
  }

  private wireTransport(transport: Transport) {
    transport.onmessage = (e: { data: WorkerResponse }) => {
      if (e.data.type === 'change') {
        const { tables } = e.data as { type: 'change'; tables: string[] };
        for (const listener of this.changeListeners) {
          listener(tables);
        }
        return;
      }

      const { id } = e.data as { id: string; type: string };
      const cb = this.pending.get(id);
      if (!cb) return;
      clearTimeout(cb.timer);
      this.pending.delete(id);

      if (e.data.type === 'success') {
        cb.resolve((e.data as any).result);
      } else {
        cb.reject(new Error((e.data as any).message));
      }
    };
  }

  /** リーダー昇格時にトランスポートを差し替える */
  _replaceTransport(transport: Transport) {
    this.transport = transport;
    this.wireTransport(transport);
  }

  send(msg: Record<string, any>, transfer?: Transferable[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = String(++this.counter);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LonaQTimeoutError());
      }, this.queryTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this.transport.postMessage({ id, ...msg }, transfer);
    });
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (!this._isReady) throw new LonaQNotReadyError();
    await this.send({ type: 'run', sql, params });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this._isReady) throw new LonaQNotReadyError();
    return (await this.send({ type: 'query', sql, params })) as T[];
  }

  async getOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction(fn: (tx: LonaQTransaction) => Promise<void>): Promise<void> {
    if (!this._isReady) throw new LonaQNotReadyError();
    await this.send({ type: 'run', sql: 'BEGIN', params: [] });
    try {
      const tx: LonaQTransaction = {
        run: (sql, params = []) => this.send({ type: 'run', sql, params }),
        query: (sql, params = []) => this.send({ type: 'query', sql, params }),
        getOne: async (sql, params = []) => {
          const rows = await this.send({ type: 'query', sql, params });
          return rows[0] ?? null;
        },
      };
      await fn(tx);
      await this.send({ type: 'run', sql: 'COMMIT', params: [] });
    } catch (e) {
      await this.send({ type: 'run', sql: 'ROLLBACK', params: [] });
      throw e;
    }
  }

  async export(): Promise<Uint8Array> {
    if (!this._isReady) throw new LonaQNotReadyError();
    return (await this.send({ type: 'export' })) as Uint8Array;
  }

  async import(data: Uint8Array): Promise<void> {
    if (!this._isReady) throw new LonaQNotReadyError();
    await this.send({ type: 'import', data });
  }

  onTableChange(listener: (tables: string[]) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  async close(): Promise<void> {
    this._isReady = false;

    // 全 pending リクエストのタイマーをクリア
    for (const { timer } of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
    this.changeListeners.clear();

    try {
      await this.send({ type: 'close' });
    } catch {
      // close 中のエラーは無視
    }
    this.transport.close();
  }

  /** @internal */
  _markReady() {
    this._isReady = true;
  }
}

/** DB を作成して接続する */
export async function createDB(
  dbName: string,
  _options: CreateDBOptions = {}
): Promise<LonaQDatabase> {
  let db: LonaQDatabaseImpl;

  // Web Locks API が使えればリーダー選出でマルチタブ対応
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const { transport, cleanup: _cleanup } = await electLeader(dbName, () =>
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    );
    db = new LonaQDatabaseImpl(transport);

    // リーダー昇格コールバックを登録
    // electLeader 内の onTransportReady に接続
  } else {
    // フォールバック: シングルタブモード（Web Locks 非対応環境）
    const worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' }
    );
    const channel = new BroadcastChannel(`lona-q:${dbName}`);
    const transport = new LeaderTransport(worker, channel);
    db = new LonaQDatabaseImpl(transport);
  }

  await db.send({ type: 'init', dbName });
  db._markReady();

  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  return db;
}
