'use client';
import React, { useEffect, useRef, useState } from 'react';
import { LonaQContext } from './context';
import { createDB } from '../core/database';
import { runMigrations } from '../core/migration';
import type { LonaQDatabase, CreateDBOptions, Migration } from '../core/types';

export interface LonaQProviderProps {
  dbName: string;
  children: React.ReactNode;
  migrations?: Migration[];
  storage?: CreateDBOptions['storage'];
  fallback?: React.ReactNode;
}

export function LonaQProvider({
  dbName,
  children,
  migrations,
  storage,
  fallback,
}: LonaQProviderProps) {
  const [db, setDb] = useState<LonaQDatabase | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // useRef は StrictMode の unmount/remount でリセットされない。
  // これにより createDB が1回だけ実行されることを保証する。
  const initRef = useRef(false);
  const dbRef = useRef<LonaQDatabase | null>(null);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      try {
        const database = await createDB(dbName, { storage });
        dbRef.current = database;

        if (migrations && migrations.length > 0) {
          await runMigrations(database, migrations);
        }

        setDb(database);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  }, [dbName, storage]);

  // 本当のアンマウント時に DB を閉じる
  useEffect(() => {
    return () => {
      dbRef.current?.close();
    };
  }, []);

  if (error) {
    return React.createElement('div', { style: { color: 'red' } }, `lona-q error: ${error.message}`);
  }

  if (!db) {
    return (fallback ?? null) as React.ReactElement | null;
  }

  return React.createElement(
    LonaQContext.Provider,
    { value: { db } },
    children
  );
}
