/// <reference lib="WebWorker" />

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

interface PrecacheEntry {
  url: string;
  revision?: string | null;
}

interface PendingAction {
  id?: number;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  createdAt: number;
  retryCount: number;
}

interface RouteCallbackOptions {
  request: Request;
  url: URL;
  event: ExtendableEvent;
}

interface SyncLikeEvent extends ExtendableEvent {
  tag: string;
}

// Schema mirrors src/lib/offline-db.ts. Both contexts MUST agree on version +
// stores; otherwise the first opener wins and the other context's reads throw
// NotFoundError. Keep version in sync with DB_VERSION in offline-db.ts.
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
  'cache-walks': { key: string; value: CachedEntity; indexes: { 'by-cached-at': number } };
  'cache-rewards': { key: string; value: CachedEntity; indexes: { 'by-cached-at': number } };
  'cache-quests': { key: string; value: CachedEntity; indexes: { 'by-cached-at': number } };
  'cache-achievements': { key: string; value: CachedEntity; indexes: { 'by-cached-at': number } };
  'aqi-cache': { key: string; value: AQICacheEntry; indexes: { 'by-cached-at': number } };
}

const SYNC_TAG = 'breeva-sync-pending-actions';
const CACHE_PREFIX = 'breeva-pwa';

// Update model = PROMPT, not force-reload. We deliberately DON'T call skipWaiting()
// on install: a new SW stays "waiting" and the old one keeps serving the running app
// (no surprise mid-session reload, no lazy-chunk version mismatch). The waiting SW
// activates on the next full close+reopen → silent update on exit. The "Refresh
// sekarang" toast (pwa.ts onNeedRefresh) posts SKIP_WAITING to apply it immediately.
clientsClaim(); // first install (no prior SW) → control the page without a reload
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ request }: RouteCallbackOptions) => request.destination === 'script' || request.destination === 'style' || request.destination === 'worker',
  new StaleWhileRevalidate({
    cacheName: `${CACHE_PREFIX}-assets`,
  })
);

registerRoute(
  ({ request }: RouteCallbackOptions) => request.destination === 'image' || request.destination === 'font',
  new CacheFirst({
    cacheName: `${CACHE_PREFIX}-media`,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 150,
        maxAgeSeconds: 60 * 60 * 24 * 14,
      }),
    ],
  })
);

registerRoute(
  ({ url }: RouteCallbackOptions) => url.origin === self.location.origin && url.pathname.startsWith('/api/vayu/'),
  new NetworkFirst({
    cacheName: `${CACHE_PREFIX}-api-vayu`,
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 120,
        maxAgeSeconds: 60 * 30,
      }),
    ],
  })
);

registerRoute(
  ({ url }: RouteCallbackOptions) => url.origin.includes('tile') || /\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: `${CACHE_PREFIX}-map-tiles`,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 500,
        maxAgeSeconds: 60 * 60 * 24 * 7,
      }),
    ],
  })
);

registerRoute(
  ({ request }: RouteCallbackOptions) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: `${CACHE_PREFIX}-pages`,
    networkTimeoutSeconds: 3,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 40,
        maxAgeSeconds: 60 * 60 * 24,
      }),
    ],
  })
);

setCatchHandler(async ({ request }: RouteCallbackOptions) => {
  if (request.destination === 'document') {
    const offlineResponse = await caches.match('/offline.html');
    if (offlineResponse) return offlineResponse;
  }

  return Response.error();
});

self.addEventListener('push', (event) => {
  let data: { title: string; body: string; icon?: string; url?: string } = {
    title: 'Breeva',
    body: 'You have a new notification',
    icon: '/icons/icon-192.png',
  };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch {
    // ignore malformed payload
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('sync', (event: Event) => {
  const syncEvent = event as SyncLikeEvent;
  if (syncEvent.tag !== SYNC_TAG) return;
  syncEvent.waitUntil(replayPendingActions());
});

async function replayPendingActions(): Promise<void> {
  const db = await getDb();
  const queue = await db.getAllFromIndex('pending-actions', 'by-created-at') as PendingAction[];

  for (const action of queue) {
    if (typeof action.id !== 'number') continue;

    try {
      const response = await fetch(action.url, {
        method: action.method,
        headers: action.headers,
        body: action.body ? JSON.stringify(action.body) : undefined,
      });

      // Same rule as the foreground queue: drop on success or permanent 4xx
      // (except 401/429), continue on transient errors. Never break — other
      // queued items may target a different endpoint.
      if (response.ok || (response.status >= 400 && response.status < 500
        && response.status !== 429 && response.status !== 401)) {
        await db.delete('pending-actions', action.id);
      }
    } catch {
      continue;
    }
  }
}

let dbPromise: ReturnType<typeof openDB<BreevaOfflineDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    // Keep version in sync with DB_VERSION in src/lib/offline-db.ts.
    dbPromise = openDB<BreevaOfflineDB>('breeva-offline', 2, {
      upgrade(db: IDBPDatabase<BreevaOfflineDB>) {
        if (!db.objectStoreNames.contains('pending-actions')) {
          const store = db.createObjectStore('pending-actions', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-created-at', 'createdAt');
          store.createIndex('by-dedupe-key', 'dedupeKey');
        }
        // The SW only reads/writes pending-actions, but the other stores must
        // exist if the SW opens the DB first; otherwise the main thread would
        // see NotFoundError on cold start.
        const cacheStores = [
          'cache-walks', 'cache-rewards', 'cache-quests', 'cache-achievements',
        ] as const;
        for (const name of cacheStores) {
          if (!db.objectStoreNames.contains(name)) {
            const s = db.createObjectStore(name, { keyPath: 'id' });
            s.createIndex('by-cached-at', 'cachedAt');
          }
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
