# CLAUDE.md — lona-q

## プロジェクト概要

**lona-q** は、Vercel/Next.js ユーザーが外部DBサービスなしでブラウザ内SQLiteを使えるようにするnpmライブラリである。
「npm install して、React hooks を書くだけで、永続的なリレーショナルデータベースがブラウザ内で動く」という体験を提供する。

### コンセプト
- Vercel はフロントエンドのデプロイは簡単だが、データの永続化には外部DBサービス（Supabase, PlanetScale 等）の契約が必要
- lona-q はこの問題を「ユーザーのブラウザ内にSQLiteデータベースを作る」ことで解決する
- データは OPFS（Origin Private File System）に永続保存され、ブラウザを閉じても、PCを再起動しても消えない
- サーバー代ゼロ、DB代ゼロで、ユーザーが何人いてもインフラ費用は変わらない

### ターゲットユーザー
- Vercel/Next.js で個人開発をしている開発者
- ハッカソンで素早くプロトタイプを作りたい人
- バックエンドDBの契約・設定なしでデータを扱いたい人
- プライバシーファーストなアプリ（データがサーバーに送信されない）を作りたい人
- SQLの知識はあるがインフラ構築に時間をかけたくない人

---

## 技術スタック

### コア技術
- **wa-sqlite**: SQLite を WebAssembly にコンパイルしたライブラリ（Roy Hashimoto 作、MIT License）
  - リポジトリ: https://github.com/rhashimoto/wa-sqlite
  - npm: `wa-sqlite`
  - SQLite自体はパブリックドメイン（ライセンス制約なし）
- **OPFS (Origin Private File System)**: ブラウザ内蔵の永続ファイルシステムAPI
  - Chrome, Firefox, Safari の全主要ブラウザ対応
  - オリジン（ドメイン）ごとにデータが完全隔離される
  - ブラウザを閉じてもデータは消えない（localStorage, IndexedDB と同等の永続性）
  - ユーザーが「閲覧データの削除」を明示的に実行した場合のみ消える
- **TypeScript**: ライブラリ全体を TypeScript で実装
- **React**: hooks API を提供（`useLonaQ`, `useQuery` 等）

### VFS（Virtual File System）の選択

wa-sqlite には複数の VFS 実装がある。lona-q では以下の戦略を取る：

1. **デフォルト: `OPFSCoopSyncVFS`**
   - COOP/COEP ヘッダー不要（SharedArrayBuffer を使わない）
   - 複数コネクション対応（複数タブから同じDBにアクセス可能）
   - ファイルシステム透過性あり（dbファイルのエクスポート/インポートが可能）
   - Web Worker 内で動作必須
   - パフォーマンスは十分に高速

2. **フォールバック: `IDBBatchAtomicVFS`**
   - OPFS が使えない古いブラウザ向け
   - IndexedDB をバックエンドに使用
   - OPFS より遅いが互換性が高い

3. **高速モード（オプション）: `AccessHandlePoolVFS`**
   - 最高速だが単一コネクションのみ（複数タブ非対応）
   - ファイルシステム透過性なし（エクスポート/インポートに工夫が必要）
   - シングルタブで使うアプリ向けのオプション

### なぜ SQLite か（他の選択肢との比較）
- **vs localStorage**: 容量5-10MB制限、文字列のみ、同期APIでUIブロック。データベースの代わりにならない
- **vs IndexedDB**: Key-Value ストアなのでJOIN・集計・複雑なクエリが不可能。API が冗長で開発体験が悪い
- **vs PGlite（PostgreSQL Wasm）**: 3MB以上、OPFS永続化未対応（IndexedDB経由のみ）、lona-qの用途にはオーバースペック
- **vs DuckDB Wasm**: 数十MB、分析特化でCRUD操作に不向き、セットアップが複雑
- **SQLite の強み**: ~1MB と軽量、OPFS との相性が最高、CRUD に最適、dbファイルはどこでも開ける（デスクトップ、モバイル、サーバーで互換性あり）

---

## アーキテクチャ

```
┌─────────────────────────────────────────────┐
│  ユーザーのアプリ (React / Next.js)          │
│                                             │
│  const db = useLonaQ('myapp')               │
│  const todos = useQuery(db,                 │
│    'SELECT * FROM todos')                   │
│  await db.run('INSERT INTO ...')            │
│                                             │
├─────────────────────────────────────────────┤
│  lona-q Public API Layer                    │
│  ├── React Hooks (useLonaQ, useQuery, etc.) │
│  ├── Vanilla JS API (createDB)              │
│  └── Export/Import utilities                │
├─────────────────────────────────────────────┤
│  lona-q Internal Layer                      │
│  ├── Worker Manager (自動Worker生成・通信)   │
│  ├── VFS Auto-Selection                     │
│  │   (OPFS → IndexedDB フォールバック)       │
│  ├── Storage Persistence Manager            │
│  │   (navigator.storage.persist() 呼び出し)  │
│  └── Error Handler                          │
├─────────────────────────────────────────────┤
│  Web Worker                                 │
│  ├── wa-sqlite (SQLite Wasm)                │
│  └── OPFSCoopSyncVFS / IDBBatchAtomicVFS   │
├─────────────────────────────────────────────┤
│  OPFS (ブラウザ内蔵ファイルシステム)          │
│  └── myapp.db (SQLite データベースファイル)   │
└─────────────────────────────────────────────┘
```

### 重要なアーキテクチャ決定

1. **Worker は内部で自動生成する**: ユーザーに Worker ファイルを作らせない。Blob URL や inline Worker で自動的にWorkerを立ち上げる
2. **COOP/COEP ヘッダーは不要にする**: `OPFSCoopSyncVFS` を使うことで SharedArrayBuffer が不要 = 特殊なHTTPヘッダー設定なしで動く
3. **フォールバックは自動**: OPFS 非対応ブラウザでは自動的に IndexedDB にフォールバック
4. **単一ファイル出力**: ライブラリは1つの npm パッケージで完結。追加のWasmファイルの配置などをユーザーにさせない

---

## API 設計

### パッケージ名・インストール
```bash
npm install lona-q
```

### Vanilla JS API (フレームワーク非依存)

```typescript
import { createDB } from 'lona-q';

// DB作成・接続（自動的にOPFSに永続化）
const db = await createDB('myapp');

// テーブル作成
await db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// データ挿入（パラメータバインド必須）
await db.run(
  'INSERT INTO todos (text) VALUES (?)',
  ['牛乳を買う']
);

// データ取得
const todos = await db.query<{ id: number; text: string; completed: number }>(
  'SELECT * FROM todos WHERE completed = ? ORDER BY created_at DESC',
  [0]
);

// 単一行取得
const todo = await db.getOne<{ id: number; text: string }>(
  'SELECT * FROM todos WHERE id = ?',
  [1]
);

// トランザクション
await db.transaction(async (tx) => {
  await tx.run('UPDATE todos SET completed = 1 WHERE id = ?', [1]);
  await tx.run('INSERT INTO logs (action) VALUES (?)', ['completed todo 1']);
});

// エクスポート（Uint8Array として取得）
const data = await db.export();

// インポート（別環境のdbファイルを読み込み）
await db.import(data);

// DB を閉じる
await db.close();
```

### React Hooks API

```typescript
import { LonaQProvider, useLonaQ, useQuery } from 'lona-q/react';

// アプリのルートで Provider を配置
function App() {
  return (
    <LonaQProvider
      dbName="myapp"
      // 初回起動時のマイグレーション定義
      migrations={[
        {
          version: 1,
          up: `
            CREATE TABLE todos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              text TEXT NOT NULL,
              completed INTEGER DEFAULT 0,
              created_at TEXT DEFAULT (datetime('now'))
            );
          `
        },
        {
          version: 2,
          up: `ALTER TABLE todos ADD COLUMN priority INTEGER DEFAULT 0;`
        }
      ]}
    >
      <TodoList />
    </LonaQProvider>
  );
}

// コンポーネントで使う
function TodoList() {
  const db = useLonaQ();

  // リアクティブクエリ（データ変更時に自動再レンダリング）
  const { data: todos, isLoading, error } = useQuery<{
    id: number;
    text: string;
    completed: number;
  }>(
    db,
    'SELECT * FROM todos WHERE completed = ? ORDER BY created_at DESC',
    [0]
  );

  const addTodo = async (text: string) => {
    await db.run('INSERT INTO todos (text) VALUES (?)', [text]);
    // useQuery が自動的に再取得してくれる
  };

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      {todos.map(todo => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </div>
  );
}
```

### 型定義

```typescript
// --- Core Types ---

interface LonaQDatabase {
  /** SQL を実行（INSERT, UPDATE, DELETE, CREATE TABLE 等） */
  run(sql: string, params?: unknown[]): Promise<void>;

  /** SELECT クエリを実行し、結果の配列を返す */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** SELECT クエリを実行し、最初の1行を返す（なければ null） */
  getOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /** トランザクションを実行 */
  transaction(fn: (tx: LonaQTransaction) => Promise<void>): Promise<void>;

  /** データベースを Uint8Array としてエクスポート */
  export(): Promise<Uint8Array>;

  /** Uint8Array からデータベースをインポート（既存データは上書き） */
  import(data: Uint8Array): Promise<void>;

  /** データベースを閉じてリソースを解放 */
  close(): Promise<void>;

  /** データベースの準備完了状態 */
  isReady: boolean;
}

interface LonaQTransaction {
  run(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  getOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}

interface CreateDBOptions {
  /**
   * ストレージバックエンド
   * - 'auto': OPFS → IndexedDB の順にフォールバック（デフォルト）
   * - 'opfs': OPFS のみ使用（非対応ブラウザではエラー）
   * - 'idb': IndexedDB のみ使用
   */
  storage?: 'auto' | 'opfs' | 'idb';
}

interface Migration {
  version: number;
  up: string;  // SQL文（セミコロン区切りで複数文可）
}

// --- React Types ---

interface LonaQProviderProps {
  dbName: string;
  children: React.ReactNode;
  migrations?: Migration[];
  storage?: CreateDBOptions['storage'];
  /** DB初期化中に表示するフォールバックUI */
  fallback?: React.ReactNode;
}

interface UseQueryResult<T> {
  data: T[];
  isLoading: boolean;
  error: Error | null;
  /** 手動で再取得 */
  refetch: () => Promise<void>;
}
```

---

## ディレクトリ構成

```
lona-q/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── README.md
├── LICENSE                    # MIT
├── src/
│   ├── index.ts               # メインエントリポイント（Vanilla JS API エクスポート）
│   ├── react.ts               # React エントリポイント（hooks エクスポート）
│   ├── core/
│   │   ├── database.ts        # LonaQDatabase クラス実装
│   │   ├── worker-manager.ts  # Worker の自動生成・メッセージング管理
│   │   ├── worker.ts          # Worker 内で実行されるコード（wa-sqlite 初期化・SQL実行）
│   │   ├── vfs-selector.ts    # VFS の自動選択ロジック（OPFS → IDB フォールバック）
│   │   ├── migration.ts       # マイグレーション管理
│   │   └── types.ts           # 共通型定義
│   ├── react/
│   │   ├── provider.tsx       # LonaQProvider コンポーネント
│   │   ├── hooks.ts           # useLonaQ, useQuery hooks
│   │   └── context.ts         # React Context 定義
│   └── utils/
│       ├── export-import.ts   # DB エクスポート/インポートユーティリティ
│       └── persistence.ts     # navigator.storage.persist() 管理
├── dist/                      # ビルド出力
└── tests/
    ├── core/
    │   ├── database.test.ts
    │   ├── worker-manager.test.ts
    │   └── migration.test.ts
    └── react/
        └── hooks.test.tsx
```

---

## 実装の詳細指示

### 1. Worker Manager (`src/core/worker-manager.ts`)

Worker をユーザーに意識させずに自動管理する。これが lona-q の最重要コンポーネント。

```typescript
// Worker コードを Blob URL で動的に生成する
// ユーザーが別途 Worker ファイルを配置する必要をなくすため
//
// 実装方針:
// 1. worker.ts の内容を文字列として埋め込み（ビルド時にバンドル）
// 2. Blob URL で Worker を生成
// 3. postMessage / onmessage でメインスレッドと通信
// 4. Promise ベースのリクエスト/レスポンス管理（requestId でマッチング）
```

メインスレッドと Worker 間のメッセージプロトコル:

```typescript
// メインスレッド → Worker
type WorkerRequest =
  | { id: string; type: 'init'; dbName: string; storage: 'opfs' | 'idb' }
  | { id: string; type: 'run'; sql: string; params: unknown[] }
  | { id: string; type: 'query'; sql: string; params: unknown[] }
  | { id: string; type: 'export' }
  | { id: string; type: 'import'; data: Uint8Array }
  | { id: string; type: 'close' }
  | { id: string; type: 'transaction'; statements: Array<{ sql: string; params: unknown[] }> };

// Worker → メインスレッド
type WorkerResponse =
  | { id: string; type: 'success'; result?: unknown }
  | { id: string; type: 'error'; message: string }
  | { type: 'ready' }  // Worker 初期化完了通知
  | { type: 'change'; tables: string[] };  // データ変更通知（useQuery の自動更新用）
```

### 2. Worker 内部 (`src/core/worker.ts`)

```typescript
// Worker 内で実行されるコード
// 
// 初期化フロー:
// 1. wa-sqlite の Wasm モジュールをロード
// 2. VFS を選択・登録（OPFSCoopSyncVFS or IDBBatchAtomicVFS）
// 3. DB をオープン
// 4. メインスレッドに 'ready' を送信
//
// wa-sqlite の使い方:
//   import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
//   import * as SQLite from 'wa-sqlite';
//   import { OPFSCoopSyncVFS } from 'wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
//   
//   const module = await SQLiteESMFactory();
//   const sqlite3 = SQLite.Factory(module);
//   
//   // VFS 登録
//   const vfs = new OPFSCoopSyncVFS();
//   await vfs.isReady;
//   sqlite3.vfs_register(vfs, true);
//   
//   // DB オープン
//   const db = await sqlite3.open_v2('myapp.db');
//
// 注意:
// - OPFSCoopSyncVFS は Worker 内でのみ動作する
// - wa-sqlite の同期ビルド (wa-sqlite.mjs) を使う（Asyncify ビルドではない）
// - OPFSCoopSyncVFS は COOP/COEP ヘッダー不要
//
// データ変更検知:
// - run() が成功した後、実行された SQL から影響テーブルを推定する
//   （INSERT INTO xxx, UPDATE xxx, DELETE FROM xxx のパターンマッチ）
// - 変更があったテーブルを 'change' メッセージでメインスレッドに通知
// - これにより useQuery が自動的に再取得を行う
```

### 3. VFS Auto-Selection (`src/core/vfs-selector.ts`)

```typescript
// ブラウザの対応状況に応じて最適な VFS を自動選択する
//
// 判定ロジック:
// 1. OPFS が使えるか確認
//    - navigator.storage.getDirectory が存在するか
//    - Worker 内で createSyncAccessHandle が使えるか
//    → 使えれば OPFSCoopSyncVFS
//
// 2. OPFS が使えなければ IndexedDB にフォールバック
//    → IDBBatchAtomicVFS
//
// 3. ユーザーが明示的に storage: 'opfs' を指定した場合は
//    OPFS が使えなければエラーを throw する
//
// 実装:
export async function detectBestVFS(): Promise<'opfs' | 'idb'> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      // OPFS のルートディレクトリ取得を試みる
      await navigator.storage.getDirectory();
      return 'opfs';
    }
  } catch {
    // OPFS 非対応
  }
  return 'idb';
}
```

### 4. React Provider (`src/react/provider.tsx`)

```typescript
// LonaQProvider は以下を行う:
// 1. マウント時に createDB() を呼んでDBを初期化
// 2. migrations が指定されていればマイグレーションを実行
// 3. 初期化完了まで fallback（またはデフォルトの Loading）を表示
// 4. Context 経由で LonaQDatabase インスタンスを子コンポーネントに提供
// 5. アンマウント時に db.close() を呼ぶ
```

### 5. useQuery Hook (`src/react/hooks.ts`)

```typescript
// useQuery は以下の動作をする:
// 1. マウント時にクエリを実行して data にセット
// 2. Worker から 'change' メッセージを受け取ったとき、
//    変更されたテーブルがこのクエリに関連していれば自動で再取得
// 3. SQL 文やパラメータが変わったら自動で再取得
// 4. isLoading, error を適切に管理
//
// テーブル関連性の判定:
// - SQL文から FROM / JOIN の後のテーブル名を簡易パースして抽出
// - Worker の 'change' に含まれるテーブル名と照合
//
// 実装のポイント:
// - useEffect でクエリ実行
// - sql と params を依存配列に入れる（params は JSON.stringify で比較）
// - Worker の change イベントはカスタムイベントまたはコールバック登録で受信
```

### 6. Migration Manager (`src/core/migration.ts`)

```typescript
// マイグレーション管理:
// 1. 内部的に _lona_q_migrations テーブルを自動作成
//    CREATE TABLE IF NOT EXISTS _lona_q_migrations (
//      version INTEGER PRIMARY KEY,
//      applied_at TEXT DEFAULT (datetime('now'))
//    );
// 2. 現在適用済みの最大バージョンを取得
// 3. 未適用のマイグレーションを version 昇順で実行
// 4. 各マイグレーションはトランザクション内で実行
// 5. 失敗したらロールバックしてエラーを throw
```

### 7. Export/Import (`src/utils/export-import.ts`)

```typescript
// エクスポート:
// - sqlite3.exec(db, "VACUUM INTO 'export.db'") を使うか、
//   または VFS からファイルバイトを直接読み出す
// - OPFSCoopSyncVFS はファイルシステム透過性があるので、
//   OPFS から直接ファイルを読み出せる
// - Uint8Array として返す
//
// インポート:
// - 受け取った Uint8Array を OPFS に書き込む
// - 既存DBを閉じて、新しいファイルでDBを再オープン
// - File System Access API を使ったファイル保存ヘルパーも提供:
//   await db.exportToFile() → ユーザーにファイル保存ダイアログを表示
//   await db.importFromFile() → ユーザーにファイル選択ダイアログを表示
```

---

## ビルド設定

### package.json

```json
{
  "name": "lona-q",
  "version": "0.1.0",
  "description": "Zero-config browser SQLite for Vercel/Next.js apps. No server, no external DB, just npm install and go.",
  "keywords": ["sqlite", "opfs", "vercel", "nextjs", "local-first", "browser-database", "wasm"],
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./react": {
      "import": "./dist/react.mjs",
      "require": "./dist/react.cjs",
      "types": "./dist/react.d.ts"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "wa-sqlite": "^1.0.0"
  },
  "peerDependencies": {
    "react": ">=18.0.0"
  },
  "peerDependenciesMeta": {
    "react": {
      "optional": true
    }
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0",
    "react": "^18.0.0",
    "@types/react": "^18.0.0",
    "eslint": "^8.0.0"
  }
}
```

### tsup.config.ts (ビルド設定)

```typescript
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      react: 'src/react.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    // Worker コードを文字列としてバンドルに含める
    // wa-sqlite の .wasm ファイルも base64 で埋め込むか、
    // CDN からロードするオプションを検討
    external: ['react'],
  },
]);
```

### Wasm ファイルの配信戦略

wa-sqlite の .wasm ファイルの扱いは重要な設計判断：

```
方法1: CDN から自動ロード（推奨・デフォルト）
  - jsDelivr 等から wa-sqlite の wasm を fetch
  - ユーザーの設定不要
  - 初回ロード時のみネットワーク必要

方法2: npm パッケージに同梱
  - パッケージサイズが大きくなる（~1MB増）
  - オフラインで確実に動く
  - Next.js の public/ へのコピーが必要になるかも

方法3: ユーザーが URL を指定
  - createDB('myapp', { wasmUrl: '/sqlite.wasm' }) のように指定
  - 自前ホスティングしたい場合向け

→ デフォルトは方法1、オプションで方法2,3を提供
```

---

## 重要な注意事項・制約

### OPFS の挙動
- データはオリジン（プロトコル + ドメイン + ポート）ごとに完全隔離される
- `https://myapp.vercel.app` と `http://localhost:3000` は別のオリジン → 別のデータ
- `localhost:3000` と `localhost:5173` も別のオリジン → 別のデータ
- 開発中のデータは本番環境に引き継がれない（エクスポート/インポートで対応）
- シークレットモード（プライベートブラウジング）ではウィンドウを閉じたらデータ消失

### ブラウザサポート
- Chrome 102+ ✅
- Firefox 111+ ✅
- Safari 17+ ✅（Safari 16.x は OPFS にバグがあり非対応、IDB フォールバック使用）
- Edge 102+ ✅（Chromium ベース）
- Android Chrome ✅（SharedWorker 非対応だが OPFSCoopSyncVFS は通常 Worker で動作）

### Next.js / Vercel 特有の注意
- SSR（サーバーサイドレンダリング）では OPFS は使えない
  → `typeof window !== 'undefined'` ガードが必須
  → React hooks は `useEffect` 内でのみ初期化
- App Router / Pages Router 両方をサポート
- `'use client'` ディレクティブが必要なコンポーネント

### セキュリティ
- OPFS のセキュリティモデルは localStorage, IndexedDB と同等
- オリジン単位で隔離されており、他サイトからアクセス不可
- COOP/COEP ヘッダーは OPFSCoopSyncVFS を使う限り不要
- ブラウザ内のデータは DevTools で閲覧可能なので、パスワードやクレジットカード番号などの機密データはそのまま保存しない
- データがサーバーに送信されないのでプライバシー的にはむしろ安全

### パフォーマンス
- navigator.storage.persist() を初期化時に呼んで永続化をリクエストする
  → ブラウザによるストレージの自動削除を防止
- 大量データの INSERT は db.transaction() でまとめる
- useQuery のリアクティブ更新はテーブル単位の粗い粒度（十分実用的）

---

## 実装の優先順位

### Phase 1: コア機能（MVP）
1. `src/core/worker.ts` — Worker 内の wa-sqlite 初期化・SQL実行
2. `src/core/worker-manager.ts` — Worker の自動生成とメッセージング
3. `src/core/vfs-selector.ts` — OPFS / IDB の自動判定
4. `src/core/database.ts` — LonaQDatabase クラス（run, query, getOne, close）
5. `src/index.ts` — createDB エクスポート
6. 基本テスト

### Phase 2: React 統合
1. `src/react/context.ts` — Context 定義
2. `src/react/provider.tsx` — LonaQProvider
3. `src/react/hooks.ts` — useLonaQ, useQuery（リアクティブ更新含む）
4. `src/react.ts` — React エントリポイント

### Phase 3: マイグレーション・エクスポート
1. `src/core/migration.ts` — マイグレーション管理
2. `src/utils/export-import.ts` — DB エクスポート/インポート
3. `src/utils/persistence.ts` — ストレージ永続化ユーティリティ

### Phase 4: DX（開発体験）向上
1. README.md（使い方ドキュメント）
2. Next.js App Router 用のサンプルコード
3. エラーメッセージの改善
4. TypeScript の型推論強化

---

## テスト方針

- **vitest** を使用（ブラウザモードでのテストが必要）
- Worker と OPFS のテストはブラウザ環境が必要なので vitest の browser mode または Playwright を使用
- モック戦略:
  - Worker は MessageChannel でモック可能
  - OPFS は in-memory VFS (MemoryVFS) でフォールバックしてテスト可能
- テストケース:
  - CRUD 操作（INSERT, SELECT, UPDATE, DELETE）
  - パラメータバインド
  - トランザクション（正常系、ロールバック）
  - マイグレーション（新規、追加、スキップ）
  - エクスポート/インポート
  - VFS フォールバック
  - React hooks のレンダリング
  - エラーハンドリング（不正SQL、DB未初期化、Worker 通信エラー等）

---

## README.md の内容ガイド

```markdown
# lona-q

> Zero-config browser SQLite for Vercel & Next.js.
> No server. No external DB. Just `npm install` and go.

## Features
- 🚀 npm install するだけで動く
- 💾 ブラウザを閉じてもデータが残る（OPFS永続化）
- 🔒 データはブラウザ内に保存、サーバーに送信されない
- ⚡ 本物のSQLite（JOIN, トランザクション, インデックス全対応）
- ⚛️ React hooks で簡単にデータバインディング
- 📦 エクスポート/インポートでデータの持ち出し可能
- 💰 サーバー代・DB代ゼロ

## Quick Start
（Vanilla JS と React の両方のコード例を載せる）

## Vercel にデプロイ
（特別な設定不要であることを強調）

## API Reference
（上記の型定義を元に）

## FAQ
- Q: ブラウザを閉じたらデータ消えますか？ → A: 消えません
- Q: 他のブラウザやデバイスでデータ共有できますか？ → A: エクスポート/インポートで可能
- Q: どのくらいのデータ量を扱えますか？ → A: ブラウザのストレージクォータ依存（通常ディスクの数十%）
- Q: Next.js の SSR で使えますか？ → A: クライアントサイドのみ。'use client' が必要

## License
MIT
```

---

## コーディング規約

- TypeScript strict mode を有効にする
- ESM 形式で記述（import/export）
- async/await を一貫して使用（.then チェーンは使わない）
- エラーは具体的なメッセージを含むカスタムエラークラスを定義
  - `LonaQError` (基底クラス)
  - `LonaQNotReadyError` (DB未初期化)
  - `LonaQQueryError` (SQL実行エラー)
  - `LonaQStorageError` (ストレージ関連エラー)
- コメントは日本語でも英語でもOK（コード中は英語推奨）
- console.log はデバッグ用のみ。本番ビルドでは出力しない
- 命名規則: camelCase（変数・関数）、PascalCase（型・クラス・コンポーネント）

---

## よくある実装上の落とし穴

1. **Worker 内での import**: バンドラーによっては Worker 内の import が正しく解決されない。Blob URL で Worker を生成する場合、依存コードを全てインライン化する必要がある。tsup の設定で Worker コードを文字列として埋め込む方法を検討すること

2. **wa-sqlite の Wasm ロード**: `SQLiteESMFactory()` は .wasm ファイルのパスを内部で解決する。Worker 内から fetch する場合、相対パスではなく絶対 URL を使う必要がある場合がある

3. **Next.js の SSR 回避**: `createDB` はブラウザ API（Worker, OPFS）に依存するので、サーバーサイドで呼ばれるとクラッシュする。dynamic import や `typeof window` チェックで確実にクライアントサイドのみで実行すること

4. **React の Strict Mode**: React 18 の Strict Mode は useEffect を2回実行する。DB の初期化が2回走らないよう、ref で初期化済みフラグを管理する

5. **複数タブ対応**: OPFSCoopSyncVFS は複数コネクション対応だが、同時書き込みで SQLITE_BUSY が返る可能性がある。リトライロジックを実装すること

6. **Safari の注意点**: Safari 17+ で OPFS 対応だが、一部 API の挙動が Chrome/Firefox と異なる場合がある。テストは全主要ブラウザで行うこと