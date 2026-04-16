// db-worker.js (ライブラリ内部に隠蔽するファイル)
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { OPFSVirtualFileSystem } from 'wa-sqlite/src/examples/OPFSVirtualFileSystem.js';

let sqlite3;
let db;

// 初期化処理
async function initDB() {
  const module = await SQLiteESMFactory();
  sqlite3 = SQLite.Factory(module);
  
  // OPFSをVFSとして登録
  const vfs = new OPFSVirtualFileSystem('my-opfs-vfs');
  sqlite3.vfs_register(vfs, true);
  
  // DBファイルを開く（無ければ作られる）
  db = await sqlite3.open_v2('my-database.db');
}

// UI（メインスレッド）からのメッセージを待つ
self.onmessage = async (event) => {
  const { id, type, sql, params } = event.data;

  if (type === 'INIT') {
    await initDB();
    self.postMessage({ id, status: 'ok' });
  } 
  else if (type === 'QUERY') {
    // クエリの実行 (wa-sqliteの便利関数を使用)
    try {
      const results = [];
      // statements関数は、SELECT結果を1行ずつyieldするジェネレーターを返します
      for await (const stmt of sqlite3.statements(db, sql)) {
        // ※ここでは簡略化していますが、実際はここでparamsのバインドや
        // カラム名の取得処理を書きます。
        results.push(sqlite3.stmt_to_array(stmt)); // 簡単のため配列で取得
      }
      self.postMessage({ id, status: 'success', data: results });
    } catch (error) {
      self.postMessage({ id, status: 'error', error: error.message });
    }
  }
};