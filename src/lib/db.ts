// IndexedDB 封装：molds / furnishes / sims / proofs / benchmarks 五张表

import type { BenchmarkDoc, FurnishDoc, MoldDoc, ProofRecord, SimRecord } from './types';

const DB_NAME = 'watermark-sim-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('molds')) db.createObjectStore('molds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('furnishes')) db.createObjectStore('furnishes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sims')) db.createObjectStore('sims', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('proofs')) db.createObjectStore('proofs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('benchmarks')) db.createObjectStore('benchmarks', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function dbPut<T>(store: string, doc: T): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(doc as unknown as object));
}

export async function dbGet<T>(store: string, id: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
}

export async function dbDelete(store: string, id: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id));
}

export async function dbAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export const Stores = {
  molds: 'molds',
  furnishes: 'furnishes',
  sims: 'sims',
  proofs: 'proofs',
  benchmarks: 'benchmarks',
} as const;

export type StoreName = keyof typeof Stores;

export async function listMolds(): Promise<MoldDoc[]> {
  return dbAll<MoldDoc>(Stores.molds);
}
export async function listFurnishes(): Promise<FurnishDoc[]> {
  return dbAll<FurnishDoc>(Stores.furnishes);
}
export async function listSims(): Promise<SimRecord[]> {
  return dbAll<SimRecord>(Stores.sims);
}
export async function listProofs(): Promise<ProofRecord[]> {
  return dbAll<ProofRecord>(Stores.proofs);
}
export async function listBenchmarks(): Promise<BenchmarkDoc[]> {
  return dbAll<BenchmarkDoc>(Stores.benchmarks);
}
