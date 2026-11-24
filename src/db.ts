// ===== IndexedDB 持久化层 =====
import type { MoldDesign, ProofRecord, PulpRecipe, SimResult } from './types';

const DB_NAME = 'watermark-mold-sim';
const DB_VERSION = 1;
const STORE = {
  molds: 'molds',
  recipes: 'recipes',
  sims: 'sims',
  proofs: 'proofs',
  blobs: 'blobs', // 大数组（Float32Array -> ArrayBuffer）
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [STORE.molds, STORE.recipes, STORE.sims, STORE.proofs]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.blobs)) db.createObjectStore(STORE.blobs);
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

export async function dbPut<T>(store: string, value: T): Promise<T> {
  await tx(store, 'readwrite', (s) => s.put(value));
  return value;
}
export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}
export async function dbGetAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}
export async function dbDelete(store: string, key: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key));
}
export async function dbClear(store: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

// ---- 大数组分块存储 ----
export async function saveArray(key: string, arr: Float32Array): Promise<void> {
  await tx(STORE.blobs, 'readwrite', (s) => s.put(arr.buffer.slice(0), key));
}
export async function loadArray(key: string): Promise<Float32Array | null> {
  const buf = await tx<ArrayBuffer | undefined>(STORE.blobs, 'readonly', (s) =>
    s.get(key) as IDBRequest<ArrayBuffer | undefined>,
  );
  return buf ? new Float32Array(buf) : null;
}
export async function deleteArray(key: string): Promise<void> {
  await tx(STORE.blobs, 'readwrite', (s) => s.delete(key));
}

// ---- 业务封装 ----
export const Stores = STORE;

export function uid(prefix = 'id'): string {
  // 不用 Math.random：时间戳 + 随机由 crypto 提供（仅用于 id，不参与仿真可复现）
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${r[0].toString(36)}${r[1].toString(36)}`;
}

export async function saveMold(m: MoldDesign): Promise<void> {
  const { relief, ...meta } = m;
  await dbPut(STORE.molds, meta);
  if (relief && m.gridW && m.gridH) {
    await saveArray(`${m.id}:relief`, relief);
  }
}
export async function loadMold(id: string): Promise<MoldDesign | null> {
  const m = await dbGet<MoldDesign>(STORE.molds, id);
  if (!m) return null;
  const relief = await loadArray(`${id}:relief`);
  if (relief) {
    m.relief = relief;
  }
  return m;
}
export async function listMolds(): Promise<MoldDesign[]> {
  const all = await dbGetAll<MoldDesign>(STORE.molds);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteMold(id: string): Promise<void> {
  await dbDelete(STORE.molds, id);
  await deleteArray(`${id}:relief`);
}

export const saveRecipe = (r: PulpRecipe) => dbPut(STORE.recipes, r);
export const listRecipes = () => dbGetAll<PulpRecipe>(STORE.recipes).then((a) => a.sort((a, b) => b.updatedAt - a.updatedAt));
export const deleteRecipe = (id: string) => dbDelete(STORE.recipes, id);

export async function saveSim(r: SimResult): Promise<void> {
  const { thicknessField, orientationField, ...meta } = r;
  await dbPut(STORE.sims, meta);
  if (thicknessField) await saveArray(`${r.id}:thickness`, thicknessField);
  if (orientationField) await saveArray(`${r.id}:orientation`, orientationField);
}
export async function loadSim(id: string): Promise<SimResult | null> {
  const r = await dbGet<SimResult>(STORE.sims, id);
  if (!r) return null;
  r.thicknessField = (await loadArray(`${id}:thickness`)) ?? undefined;
  r.orientationField = (await loadArray(`${id}:orientation`)) ?? undefined;
  return r;
}
export async function listSims(): Promise<SimResult[]> {
  return (await dbGetAll<SimResult>(STORE.sims)).sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteSim(id: string): Promise<void> {
  await dbDelete(STORE.sims, id);
  await deleteArray(`${id}:thickness`);
  await deleteArray(`${id}:orientation`);
}

export const saveProof = (p: ProofRecord) => dbPut(STORE.proofs, p);
export const listProofs = () => dbGetAll<ProofRecord>(STORE.proofs).then((a) => a.sort((a, b) => b.createdAt - a.createdAt));
export const deleteProof = (id: string) => dbDelete(STORE.proofs, id);

export { uid as newId };
