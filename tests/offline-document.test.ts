import { describe, expect, it } from 'vitest';
import { OFFLINE_PAGE, SHELL, offlineDocument } from '../src/lib/pwa/offlineDocument';

const store = (files: Record<string, string>) => async (url: string) => (url in files ? new Response(files[url]) : undefined);

describe('page for a navigation without network (F2-09)', () => {
  it('serves the app shell, so a new route link still opens offline', async () => {
    const r = await offlineDocument(store({ [SHELL]: 'shell', [OFFLINE_PAGE]: 'offline' }));
    expect(await r!.text()).toBe('shell');
  });
  it('falls back to the offline page when the shell is missing, and to nothing when both are', async () => {
    expect(await (await offlineDocument(store({ [OFFLINE_PAGE]: 'offline' })))!.text()).toBe('offline');
    expect(await offlineDocument(store({}))).toBeUndefined();
  });
});
