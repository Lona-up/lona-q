'use client';
import { createContext } from 'react';
import type { LonaQDatabase } from '../core/types';

export interface LonaQContextValue {
  db: LonaQDatabase;
}

export const LonaQContext = createContext<LonaQContextValue | null>(null);
