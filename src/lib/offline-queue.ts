import {
  addPendingAction,
  bumpPendingActionRetry,
  listPendingActions,
  removePendingAction,
  type PendingAction,
} from './offline-db';
import { dispatchPwaStatus } from './pwa-events';

const SYNC_TAG = 'breeva-sync-pending-actions';
const MAX_RETRIES = 3;

interface SyncManagerLike {
  register(tag: string): Promise<void>;
}

type QueueResult = {
  ok: boolean;
  queued: boolean;
  status?: number;
  data?: unknown;
};

export async function sendOrQueueMutation(input: {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  dedupeKey?: string;
}): Promise<QueueResult> {
  const method = input.method || 'POST';

  if (!navigator.onLine) {
    await enqueueMutation({ ...input, method });
    return { ok: true, queued: true };
  }

  try {
    const response = await fetch(input.url, {
      method,
      headers: input.headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    });

    const responseData = await response.clone().json().catch(() => null);

    if (response.ok) {
      return { ok: true, queued: false, status: response.status, data: responseData };
    }

    if (response.status >= 500 || response.status === 429) {
      await enqueueMutation({ ...input, method });
      return { ok: true, queued: true, status: response.status, data: responseData };
    }

    return { ok: false, queued: false, status: response.status, data: responseData };
  } catch {
    await enqueueMutation({ ...input, method });
    return { ok: true, queued: true };
  }
}

async function enqueueMutation(input: {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  dedupeKey?: string;
}) {
  await addPendingAction({
    url: input.url,
    method: input.method,
    headers: input.headers,
    body: input.body,
    dedupeKey: input.dedupeKey,
  });

  dispatchPwaStatus({
    kind: 'sync-queued',
    title: 'Tersimpan untuk sinkronisasi',
    message: 'Perubahan kamu aman di perangkat ini dan akan dikirim otomatis saat online kembali.',
    autoHideMs: 3200,
  });

  await registerBackgroundSync();
}

export async function replayPendingMutations(): Promise<void> {
  const queue = await listPendingActions();
  if (queue.length === 0) return;

  let syncedCount = 0;

  for (const action of queue) {
    if (typeof action.id !== 'number') continue;

    try {
      const response = await executeAction(action);
      if (response.ok) {
        await removePendingAction(action.id);
        syncedCount += 1;
        continue;
      }

      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        await removePendingAction(action.id);
        syncedCount += 1;
        continue;
      }

      await handleRetry(action.id, action.retryCount);
      break;
    } catch {
      await handleRetry(action.id, action.retryCount);
      break;
    }
  }

  if (syncedCount > 0) {
    dispatchPwaStatus({
      kind: 'sync-complete',
      title: 'Sinkronisasi selesai',
      message: `${syncedCount} perubahan offline sudah berhasil dikirim ke server.`,
      autoHideMs: 3200,
    });
  }
}

async function executeAction(action: PendingAction) {
  return fetch(action.url, {
    method: action.method,
    headers: action.headers,
    body: action.body ? JSON.stringify(action.body) : undefined,
  });
}

async function handleRetry(actionId: number, currentRetryCount: number) {
  if (currentRetryCount + 1 >= MAX_RETRIES) {
    await removePendingAction(actionId);
    return;
  }
  await bumpPendingActionRetry(actionId);
}

async function registerBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      await (registration as ServiceWorkerRegistration & { sync: SyncManagerLike }).sync.register(SYNC_TAG);
    }
  } catch {
    // Foreground retry will still handle sync.
  }
}

export function initOfflineQueueSync() {
  const onOnline = () => {
    replayPendingMutations().catch(() => {});
  };

  window.addEventListener('online', onOnline);

  if (navigator.onLine) {
    replayPendingMutations().catch(() => {});
  }

  return () => {
    window.removeEventListener('online', onOnline);
  };
}
