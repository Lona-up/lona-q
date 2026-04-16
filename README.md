# lona-q

> Zero-config browser SQLite for Vercel & Next.js.
> No server. No external DB. Just `npm install` and go.

## Features

- **Just `npm install`** — Zero configuration required
- **Data persists after closing the browser** — Saved to OPFS (Origin Private File System)
- **Data stays in the browser** — Never sent to a server (privacy-first)
- **Real SQLite** — Full support for JOINs, transactions, and indexes
- **React hooks** — Reactive data binding with `useQuery`
- **Multi-tab support** — Safe data sharing via leader election pattern
- **Export / Import** — Back up and restore your data anytime

## Quick Start

### Install

```bash
npm install @lona-up/lona-q
```

### Vanilla JS

```typescript
import { createDB } from '@lona-up/lona-q';

const db = await createDB('myapp');

await db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0
  )
`);

await db.run('INSERT INTO todos (text) VALUES (?)', ['Buy milk']);

const todos = await db.query('SELECT * FROM todos');
console.log(todos); // [{ id: 1, text: 'Buy milk', completed: 0 }]
```

### React

```tsx
import { LonaQProvider, useLonaQ, useQuery } from '@lona-up/lona-q/react';
import type { Migration } from '@lona-up/lona-q';

const migrations: Migration[] = [
  {
    version: 1,
    up: `CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      completed INTEGER DEFAULT 0
    )`,
  },
];

function App() {
  return (
    <LonaQProvider dbName="myapp" migrations={migrations}>
      <TodoList />
    </LonaQProvider>
  );
}

function TodoList() {
  const db = useLonaQ();
  const { data: todos } = useQuery<{ id: number; text: string; completed: number }>(
    'SELECT * FROM todos ORDER BY id DESC'
  );

  const addTodo = async (text: string) => {
    await db.run('INSERT INTO todos (text) VALUES (?)', [text]);
    // useQuery automatically refetches — no manual refresh needed
  };

  return (
    <ul>
      {todos.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  );
}
```

## API Reference

### `createDB(dbName, options?)`

Creates and connects to a database.

```typescript
const db = await createDB('myapp');
```

### `db.run(sql, params?)`

Executes INSERT, UPDATE, DELETE, CREATE TABLE, etc.

```typescript
await db.run('INSERT INTO users (name) VALUES (?)', ['Alice']);
```

### `db.query<T>(sql, params?)`

Executes a SELECT query and returns an array of results.

```typescript
const users = await db.query<{ id: number; name: string }>('SELECT * FROM users');
```

### `db.getOne<T>(sql, params?)`

Returns the first row, or `null` if none found.

```typescript
const user = await db.getOne('SELECT * FROM users WHERE id = ?', [1]);
```

### `db.transaction(fn)`

Executes a transaction. Automatically rolls back on error.

```typescript
await db.transaction(async (tx) => {
  await tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1]);
  await tx.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2]);
});
```

### `db.export()` / `db.import(data)`

Export / import the database in JSON format.

```typescript
const data = await db.export();
// Save data somewhere...

// Restore on another environment
await db.import(data);
```

### `db.close()`

Closes the database and releases resources.

## React Hooks

### `<LonaQProvider>`

Place at the root of your app.

```tsx
<LonaQProvider
  dbName="myapp"
  migrations={[{ version: 1, up: 'CREATE TABLE ...' }]}
  fallback={<p>Loading...</p>}
>
  {children}
</LonaQProvider>
```

### `useLonaQ()`

Get the database instance (for mutations).

### `useQuery<T>(sql, params?)`

Reactive SELECT query. Automatically refetches when data changes.

```typescript
const { data, isLoading, error, refetch } = useQuery<Todo>(
  'SELECT * FROM todos WHERE completed = ?',
  [0]
);
```

## Multi-Tab Support

lona-q supports multiple tabs via a leader election pattern.

- The first tab to open becomes the **leader** and directly operates SQLite
- Subsequent tabs become **followers** and execute queries through the leader
- When the leader is closed, a follower is automatically promoted to the new leader
- Table changes are broadcast to all tabs in real time

No special configuration needed — just call `createDB()` and it works.

## Deploying to Vercel / Next.js

No special configuration required. Just `npm run build` and deploy to Vercel.

**Note**: lona-q runs on the client side only. It cannot be used in Server Components. The `'use client'` directive is required.

## FAQ

**Q: Will my data disappear when I close the browser?**
A: No. Data is persisted in OPFS and survives browser restarts.

**Q: Can I share data across browsers or devices?**
A: You can use export/import to transfer data between environments.

**Q: How much data can I store?**
A: It depends on the browser's storage quota (typically tens of percent of disk space).

**Q: Can I use this with Next.js SSR?**
A: Client-side only. The `'use client'` directive is required.

**Q: What happens if I open multiple tabs?**
A: lona-q uses a leader election pattern to handle this safely. No data conflicts will occur.

## Browser Support

- Chrome 102+
- Firefox 111+
- Safari 17+
- Edge 102+

## License

MIT

---

## 日本語 / Japanese

以下は日本語版のドキュメントです。

### Features

- **npm install するだけで動く** — 追加設定不要
- **ブラウザを閉じてもデータが残る** — OPFS に永続保存
- **データはブラウザ内に保存** — サーバーに送信されない（プライバシーファースト）
- **本物の SQLite** — JOIN, トランザクション, インデックス全対応
- **React hooks** — `useQuery` でリアクティブなデータバインディング
- **複数タブ対応** — リーダー選出パターンで安全にデータ共有
- **エクスポート/インポート** — データの持ち出し・復元が可能

### Quick Start

#### Install

```bash
npm install @lona-up/lona-q
```

#### Vanilla JS

```typescript
import { createDB } from '@lona-up/lona-q';

const db = await createDB('myapp');

await db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0
  )
`);

await db.run('INSERT INTO todos (text) VALUES (?)', ['Buy milk']);

const todos = await db.query('SELECT * FROM todos');
console.log(todos); // [{ id: 1, text: 'Buy milk', completed: 0 }]
```

#### React

```tsx
import { LonaQProvider, useLonaQ, useQuery } from '@lona-up/lona-q/react';
import type { Migration } from '@lona-up/lona-q';

const migrations: Migration[] = [
  {
    version: 1,
    up: `CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      completed INTEGER DEFAULT 0
    )`,
  },
];

function App() {
  return (
    <LonaQProvider dbName="myapp" migrations={migrations}>
      <TodoList />
    </LonaQProvider>
  );
}

function TodoList() {
  const db = useLonaQ();
  const { data: todos } = useQuery<{ id: number; text: string; completed: number }>(
    'SELECT * FROM todos ORDER BY id DESC'
  );

  const addTodo = async (text: string) => {
    await db.run('INSERT INTO todos (text) VALUES (?)', [text]);
    // useQuery が自動的に再取得 — 手動リフレッシュ不要
  };

  return (
    <ul>
      {todos.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  );
}
```

### API リファレンス

#### `createDB(dbName, options?)`

データベースを作成して接続します。

```typescript
const db = await createDB('myapp');
```

#### `db.run(sql, params?)`

INSERT, UPDATE, DELETE, CREATE TABLE 等を実行します。

```typescript
await db.run('INSERT INTO users (name) VALUES (?)', ['Alice']);
```

#### `db.query<T>(sql, params?)`

SELECT クエリを実行し、結果の配列を返します。

```typescript
const users = await db.query<{ id: number; name: string }>('SELECT * FROM users');
```

#### `db.getOne<T>(sql, params?)`

最初の1行を返します（なければ `null`）。

```typescript
const user = await db.getOne('SELECT * FROM users WHERE id = ?', [1]);
```

#### `db.transaction(fn)`

トランザクションを実行します。エラー時は自動ロールバック。

```typescript
await db.transaction(async (tx) => {
  await tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1]);
  await tx.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2]);
});
```

#### `db.export()` / `db.import(data)`

データベースを JSON 形式でエクスポート/インポートします。

```typescript
const data = await db.export();
// data を保存...

// 別環境で復元
await db.import(data);
```

#### `db.close()`

データベースを閉じてリソースを解放します。

### React Hooks

#### `<LonaQProvider>`

アプリのルートに配置します。

```tsx
<LonaQProvider
  dbName="myapp"
  migrations={[{ version: 1, up: 'CREATE TABLE ...' }]}
  fallback={<p>Loading...</p>}
>
  {children}
</LonaQProvider>
```

#### `useLonaQ()`

データベースインスタンスを取得します（mutations 用）。

#### `useQuery<T>(sql, params?)`

リアクティブな SELECT クエリ。データ変更時に自動で再取得されます。

```typescript
const { data, isLoading, error, refetch } = useQuery<Todo>(
  'SELECT * FROM todos WHERE completed = ?',
  [0]
);
```

### 複数タブ対応

lona-q はリーダー選出パターンで複数タブに対応しています。

- 最初に開いたタブが**リーダー**になり、SQLite を直接操作
- 後から開いたタブは**フォロワー**として、リーダー経由でクエリを実行
- リーダーが閉じられると、フォロワーが自動的に新リーダーに昇格
- テーブル変更は全タブにリアルタイムで通知

特別な設定は不要で、`createDB()` を呼ぶだけで動作します。

### Vercel / Next.js にデプロイ

特別な設定は不要です。`npm run build` して Vercel にデプロイするだけ。

**注意**: lona-q はクライアントサイドのみで動作します。Server Components では使えません。`'use client'` ディレクティブが必要です。

### FAQ

**Q: ブラウザを閉じたらデータ消えますか？**
A: 消えません。OPFS に永続保存されます。

**Q: 他のブラウザやデバイスでデータ共有できますか？**
A: エクスポート/インポートで可能です。

**Q: どのくらいのデータ量を扱えますか？**
A: ブラウザのストレージクォータ依存です（通常ディスクの数十%）。

**Q: Next.js の SSR で使えますか？**
A: クライアントサイドのみです。`'use client'` が必要です。

**Q: 複数タブで開くとどうなりますか？**
A: リーダー選出パターンで安全に動作します。データの競合は起きません。

### ブラウザサポート

- Chrome 102+
- Firefox 111+
- Safari 17+
- Edge 102+

### ライセンス

MIT
