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

interface BreevaOfflineDB extends DBSchema {
  'pending-actions': {
    key: number;
    value: PendingAction;
    indexes: {
      'by-created-at': number;
    };
  };
}

const SYNC_TAG = 'breeva-sync-pending-actions';
const CACHE_PREFIX = 'breeva-pwa';

self.skipWaiting();
clientsClaim();

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

      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        await db.delete('pending-actions', action.id);
      }
    } catch {
      break;
    }
  }
}

let dbPromise: ReturnType<typeof openDB<BreevaOfflineDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<BreevaOfflineDB>('breeva-offline', 1, {
      upgrade(db: IDBPDatabase<BreevaOfflineDB>) {
        if (!db.objectStoreNames.contains('pending-actions')) {
          const store = db.createObjectStore('pending-actions', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-created-at', 'createdAt');
        }
      },
    });
  }

  return dbPromise;
}
