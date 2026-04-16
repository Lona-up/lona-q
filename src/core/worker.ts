import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { AccessHandlePoolVFS } from 'wa-sqlite/src/examples/AccessHandlePoolVFS.js';
import type { WorkerRequest, WorkerResponse } from './types';

let sqlite3: ReturnType<typeof SQLite.Factory>;
let db: number;

function extractMutatedTables(sql: string): string[] {
  const tables = new Set<string>();
  const patterns = [
    /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`]?(\w+)["'`]?/gi,
    /UPDATE\s+(?:OR\s+\w+\s+)?["'`]?(\w+)["'`]?/gi,
    /DELETE\s+FROM\s+["'`]?(\w+)["'`]?/gi,
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi,
    /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(sql)) !== null) {
      const name = match[1].toLowerCase();
      if (!name.startsWith('_lona_q_')) tables.add(name);
    }
  }
  return Array.from(tables);
}

function respond(msg: WorkerResponse) {
  self.postMessage(msg);
}

function notifyChange(sql: string) {
  const tables = extractMutatedTables(sql);
  if (tables.length > 0) {
    self.postMessage({ type: 'change', tables } as WorkerResponse);
  }
}

// OPFS ディレクトリを再帰的に削除する
async function clearOPFSDirectory(path: string) {
  try {
    const root = await navigator.storage.getDirectory();
    let dir = root;
    for (const segment of path.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(segment);
    }
    // ディレクトリ内の全エントリを削除
    for await (const [name] of (dir as any).entries()) {
      await dir.removeEntry(name, { recursive: true });
    }
  } catch {
    // ディレクトリが存在しない場合は無視
  }
}

async function initDB(dbName: string) {
  if (db !== undefined) return;
  console.log('[lona-q] initializing...');

  const dirPath = `/lona-q/${dbName}`;

  const module = await SQLiteESMFactory();
  sqlite3 = SQLite.Factory(module);

  const vfs = new AccessHandlePoolVFS(dirPath);
  await vfs.isReady;

  // プールに空きスロットがなければ拡張（ジャーナル/一時ファイル用に4つ確保）
  const MIN_FREE_SLOTS = 4;
  const freeSlots = vfs.getCapacity() - vfs.getSize();
  if (freeSlots < MIN_FREE_SLOTS) {
    await vfs.addCapacity(MIN_FREE_SLOTS - freeSlots);
  }

  sqlite3.vfs_register(vfs, true);

  try {
    db = await sqlite3.open_v2(`${dbName}.db`);
  } catch (e) {
    // DB オープン失敗 → OPFS をクリアして再試行（1回だけ）
    console.warn('[lona-q] DB open failed, clearing OPFS and retrying...');
    try { await vfs.close(); } catch { /* ignore */ }
    await clearOPFSDirectory(dirPath);

    // wa-sqlite を再初期化
    const module2 = await SQLiteESMFactory();
    sqlite3 = SQLite.Factory(module2);

    const vfs2 = new AccessHandlePoolVFS(dirPath);
    await vfs2.isReady;
    sqlite3.vfs_register(vfs2, true);

    db = await sqlite3.open_v2(`${dbName}.db`);
  }

  console.log('[lona-q] DB opened');
}

// === Export: 全テーブルの CREATE 文とデータを JSON として返す ===
async function handleExport(): Promise<Uint8Array> {
  const dump: { schema: string[]; data: Record<string, unknown[][]> } = {
    schema: [],
    data: {},
  };

  // テーブル定義を取得
  const tables: { name: string; sql: string }[] = [];
  await sqlite3.exec(db,
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE '_lona_q_%' ORDER BY name",
    (row: unknown[], columns: string[]) => {
      tables.push({ name: row[0] as string, sql: row[1] as string });
    }
  );

  for (const table of tables) {
    dump.schema.push(table.sql);

    // テーブルデータを取得
    const rows: unknown[][] = [];
    await sqlite3.exec(db, `SELECT * FROM "${table.name}"`,
      (row: unknown[]) => { rows.push([...row]); }
    );
    dump.data[table.name] = rows;
  }

  const json = JSON.stringify(dump);
  return new TextEncoder().encode(json);
}

// === Import: JSON ダンプからテーブルを復元 ===
async function handleImport(data: Uint8Array): Promise<void> {
  const json = new TextDecoder().decode(data);
  const dump: { schema: string[]; data: Record<string, unknown[][]> } = JSON.parse(json);

  // 既存テーブルを全削除
  const existingTables: string[] = [];
  await sqlite3.exec(db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_lona_q_%'",
    (row: unknown[]) => { existingTables.push(row[0] as string); }
  );
  for (const name of existingTables) {
    await sqlite3.exec(db, `DROP TABLE IF EXISTS "${name}"`);
  }

  // スキーマを復元
  for (const sql of dump.schema) {
    await sqlite3.exec(db, sql);
  }

  // データを復元
  for (const [tableName, rows] of Object.entries(dump.data)) {
    if (rows.length === 0) continue;
    const colCount = rows[0].length;
    const placeholders = Array(colCount).fill('?').join(',');
    const insertSql = `INSERT INTO "${tableName}" VALUES (${placeholders})`;
    for (const row of rows) {
      await sqlite3.run(db, insertSql, row);
    }
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type } = event.data;

  try {
    switch (type) {
      case 'init': {
        await initDB(event.data.dbName);
        respond({ id, type: 'success' });
        break;
      }

      case 'run': {
        const { sql, params } = event.data;
        await sqlite3.run(db, sql, params.length > 0 ? params : undefined);
        respond({ id, type: 'success' });
        notifyChange(sql);
        break;
      }

      case 'query': {
        const { sql, params } = event.data;
        const { rows, columns } = await sqlite3.execWithParams(
          db, sql, params.length > 0 ? params : undefined
        );
        const results = rows.map((row: unknown[]) => {
          const obj: Record<string, unknown> = {};
          columns.forEach((col: string, i: number) => {
            obj[col] = row[i];
          });
          return obj;
        });
        respond({ id, type: 'success', result: results });
        break;
      }

      case 'export': {
        const data = await handleExport();
        respond({ id, type: 'success', result: data });
        break;
      }

      case 'import': {
        await handleImport(event.data.data);
        respond({ id, type: 'success' });
        break;
      }

      case 'close': {
        await sqlite3.close(db);
        respond({ id, type: 'success' });
        break;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[lona-q] error:', message);
    respond({ id, type: 'error', message });
  }
};
