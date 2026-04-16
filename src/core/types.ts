// === Worker 通信プロトコル ===

export type WorkerRequest =
  | { id: string; type: 'init'; dbName: string; storage: 'auto' | 'opfs' | 'idb' }
  | { id: string; type: 'run'; sql: string; params: unknown[] }
  | { id: string; type: 'query'; sql: string; params: unknown[] }
  | { id: string; type: 'export' }
  | { id: string; type: 'import'; data: Uint8Array }
  | { id: string; type: 'close' };

export type WorkerResponse =
  | { id: string; type: 'success'; result?: unknown }
  | { id: string; type: 'error'; message: string }
  | { type: 'change'; tables: string[] };

// === リーダー選出: タブ間通信プロトコル ===

export type TabId = string;

export type LeaderMessage =
  | { type: 'heartbeat'; leaderId: TabId }
  | { type: 'leader-ready'; leaderId: TabId }
  | { type: 'leader-closing'; leaderId: TabId }
  | { type: 'change'; tables: string[] }
  | { type: 'request'; tabId: TabId; payload: WorkerRequest }
  | { type: 'response'; tabId: TabId; payload: WorkerResponse };

// === Public API Types ===

export interface CreateDBOptions {
  storage?: 'auto' | 'opfs' | 'idb';
}

export interface Migration {
  version: number;
  up: string;
}

export interface LonaQDatabase {
  run(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  getOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction(fn: (tx: LonaQTransaction) => Promise<void>): Promise<void>;
  export(): Promise<Uint8Array>;
  import(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  onTableChange(listener: (tables: string[]) => void): () => void;
  isReady: boolean;
}

export interface LonaQTransaction {
  run(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  getOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}
