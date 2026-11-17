import { describe, expect, it } from 'vitest';
import { withRetry } from '../src/lib/field/fetchRetry';

const netErr = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
const noSleep = async () => {};

describe('builder fetch retry (F2-18)', () => {
  it('a passing network fault is tried again and the run goes on', async () => {
    let n = 0;
    const waits: number[] = [];
    const f = withRetry(async () => { if (n++ < 2) throw netErr(); return new Response('ok'); }, { sleep: noSleep, onRetry: (i) => waits.push(i.waitMs) });
    const r = await f('https://air-quality-api.open-meteo.com/v1/air-quality?x=1');
    expect(await r.text()).toBe('ok');
    expect(waits).toEqual([2000, 5000]);
  });

  it('a source that stays down fails with its host named, after the retries', async () => {
    const f = withRetry(async () => { throw netErr(); }, { sleep: noSleep });
    await expect(f('https://api.openaq.org/v3/sensors/1/hours')).rejects.toThrow(/fetch api\.openaq\.org: fetch failed \(ECONNRESET\) after 4 tries/);
  });

  it('5xx and 429 are retried; other 4xx come back at once', async () => {
    let n = 0;
    const f = withRetry(async () => new Response('', { status: n++ === 0 ? 503 : 200 }), { sleep: noSleep });
    expect((await f('https://x.test/a')).status).toBe(200);
    let calls = 0;
    const g = withRetry(async () => { calls++; return new Response('', { status: 404 }); }, { sleep: noSleep });
    expect((await g('https://x.test/b')).status).toBe(404);
    expect(calls).toBe(1);
    let k = 0;
    const h = withRetry(async () => new Response('', { status: k++ === 0 ? 429 : 200 }), { sleep: noSleep });
    expect((await h('https://x.test/c')).status).toBe(200);
  });

  it('a 5xx that never clears is returned to the caller after the retries', async () => {
    let calls = 0;
    const f = withRetry(async () => { calls++; return new Response('', { status: 502 }); }, { sleep: noSleep });
    expect((await f('https://x.test/d')).status).toBe(502);
    expect(calls).toBe(4);
  });

  it('the shared budget stops retrying once spent, so a dead source cannot push the run past the Lambda limit', async () => {
    let calls = 0;
    const f = withRetry(async () => { calls++; throw netErr(); }, { sleep: noSleep, delaysMs: [2000, 5000, 10000], budgetMs: 9000 });
    await expect(f('https://a.test/1')).rejects.toThrow(/after 3 tries/); // 2000 + 5000 spent, 10000 > 2000 left
    expect(f.budgetLeftMs()).toBe(2000);
    calls = 0;
    await expect(f('https://a.test/2')).rejects.toThrow(/after 2 tries/); // one more 2000 pause, then nothing left
    expect(calls).toBe(2);
    expect(f.budgetLeftMs()).toBe(0);
  });
});
