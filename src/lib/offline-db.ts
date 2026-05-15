import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type CacheBucket = 'walks' | 'rewards' | 'quests' | 'achievements';
type CacheStoreName = 'cache-walks' | 'cache-rewards' | 'cache-quests' | 'cache-achievements';

export interface PendingAction {
  id?: number;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  createdAt: number;
  retryCount: number;
  dedupeKey?: string;
}

interface CachedEntity {
  id: string;
  payload: unknown;
  cachedAt: number;
}

interface AQICacheEntry {
  key: string;
  payload: unknown;
  cachedAt: number;
}

interface BreevaOfflineDB extends DBSchema {
  'pending-actions': {
    key: number;
    value: PendingAction;
    indexes: {
      'by-created-at': number;
      'by-dedupe-key': string;
    };
  };
  'cache-walks': {
    key: string;
    value: CachedEntity;
    indexes: { 'by-cached-at': number };
  };
  'cache-rewards': {
    key: string;
    value: CachedEntity;
    indexes: { 'by-cached-at': number };
  };
  'cache-quests': {
    key: string;
    value: CachedEntity;
    indexes: { 'by-cached-at': number };
  };
  'cache-achievements': {
    key: string;
    value: CachedEntity;
    indexes: { 'by-cached-at': number };
  };
  'aqi-cache': {
    key: string;
    value: AQICacheEntry;
    indexes: { 'by-cached-at': number };
  };
}

const DB_NAME = 'breeva-offline';
// v2: SW and main thread now share the same 6-store schema. Bumping the
// version forces a single upgrade on existing installs so both contexts see
// the same object stores regardless of which one opens the DB first.
const DB_VERSION = 2;
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const AQI_TTL_MS = 1000 * 60 * 15;

let dbPromise: Promise<IDBPDatabase<BreevaOfflineDB>> | null = null;

function getStoreName(bucket: CacheBucket): CacheStoreName {
  return `cache-${bucket}` as CacheStoreName;
}

export function getOfflineDb() {
  if (!dbPromise) {
    dbPromise = openDB<BreevaOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db: IDBPDatabase<BreevaOfflineDB>) {
        // Use contains() guards so a half-initialized DB from SW v1 can be
        // upgraded without "store already exists" errors.
        if (!db.objectStoreNames.contains('pending-actions')) {
          const pending = db.createObjectStore('pending-actions', { keyPath: 'id', autoIncrement: true });
          pending.createIndex('by-created-at', 'createdAt');
          pending.createIndex('by-dedupe-key', 'dedupeKey');
        }
        if (!db.objectStoreNames.contains('cache-walks')) {
          const walks = db.createObjectStore('cache-walks', { keyPath: 'id' });
          walks.createIndex('by-cached-at', 'cachedAt');
        }
        if (!db.objectStoreNames.contains('cache-rewards')) {
          const rewards = db.createObjectStore('cache-rewards', { keyPath: 'id' });
          rewards.createIndex('by-cached-at', 'cachedAt');
        }
        if (!db.objectStoreNames.contains('cache-quests')) {
          const quests = db.createObjectStore('cache-quests', { keyPath: 'id' });
          quests.createIndex('by-cached-at', 'cachedAt');
        }
        if (!db.objectStoreNames.contains('cache-achievements')) {
          const achievements = db.createObjectStore('cache-achievements', { keyPath: 'id' });
          achievements.createIndex('by-cached-at', 'cachedAt');
        }
        if (!db.objectStoreNames.contains('aqi-cache')) {
          const aqi = db.createObjectStore('aqi-cache', { keyPath: 'key' });
          aqi.createIndex('by-cached-at', 'cachedAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheCollection<T extends { id: string }>(bucket: CacheBucket, rows: T[]): Promise<void> {
  const db = await getOfflineDb();
  const store = getStoreName(bucket);
  const tx = db.transaction(store, 'readwrite');
  await tx.store.clear();

  const now = Date.now();
  for (const row of rows) {
    await tx.store.put({ id: row.id, payload: row, cachedAt: now });
  }

  await tx.done;
}

export async function getCachedCollection<T>(bucket: CacheBucket): Promise<T[]> {
  const db = await getOfflineDb();
  const store = getStoreName(bucket);
  const rows = await db.getAll(store) as CachedEntity[];
  if (rows.length === 0) return [];

  const newest = Math.max(...rows.map((r) => r.cachedAt));
  if (Date.now() - newest > CACHE_TTL_MS) {
    return [];
  }

  return rows.map((r) => r.payload as T);
}

export async function putAqiCache(key: string, payload: unknown): Promise<void> {
  const db = await getOfflineDb();
  await db.put('aqi-cache', { key, payload, cachedAt: Date.now() });
}

export async function getAqiCache<T>(key: string): Promise<T | null> {
  const db = await getOfflineDb();
  const row = await db.get('aqi-cache', key);
  if (!row) return null;
  if (Date.now() - row.cachedAt > AQI_TTL_MS) return null;
  return row.payload as T;
}

export async function addPendingAction(action: Omit<PendingAction, 'id' | 'createdAt' | 'retryCount'>): Promise<number> {
  const db = await getOfflineDb();

  if (action.dedupeKey) {
    const existing = await db.getAllFromIndex('pending-actions', 'by-dedupe-key', action.dedupeKey) as PendingAction[];
    if (existing.length > 0) {
      const first = existing[0];
      if (typeof first.id === 'number') return first.id;
    }
  }

  return db.add('pending-actions', {
    ...action,
    createdAt: Date.now(),
    retryCount: 0,
  });
}

export async function listPendingActions(): Promise<PendingAction[]> {
  const db = await getOfflineDb();
  return db.getAllFromIndex('pending-actions', 'by-created-at') as Promise<PendingAction[]>;
}

export async function removePendingAction(id: number): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('pending-actions', id);
}

export async function bumpPendingActionRetry(id: number): Promise<void> {
  const db = await getOfflineDb();
  const current = await db.get('pending-actions', id);
  if (!current) return;
  await db.put('pending-actions', {
    ...current,
    retryCount: current.retryCount + 1,
  });
}
