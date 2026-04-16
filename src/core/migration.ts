import type { LonaQDatabase, Migration } from './types';

/**
 * マイグレーションを実行する。
 * _lona_q_migrations テーブルで適用済みバージョンを管理し、
 * 未適用のマイグレーションを昇順で実行する。
 */
export async function runMigrations(
  db: LonaQDatabase,
  migrations: Migration[]
): Promise<void> {
  // マイグレーション管理テーブルを作成
  await db.run(`
    CREATE TABLE IF NOT EXISTS _lona_q_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 現在の最大バージョンを取得
  const row = await db.getOne<{ v: number | null }>(
    'SELECT MAX(version) as v FROM _lona_q_migrations'
  );
  const currentVersion = row?.v ?? 0;

  // 未適用のマイグレーションを昇順で実行
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.transaction(async (tx) => {
      // up SQL を実行（セミコロン区切りの複数文対応）
      await tx.run(migration.up);
      // 適用済みとして記録
      await tx.run(
        'INSERT INTO _lona_q_migrations (version) VALUES (?)',
        [migration.version]
      );
    });
  }
}
