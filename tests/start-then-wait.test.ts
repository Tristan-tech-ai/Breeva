import { describe, expect, it } from 'vitest';
import { startThenWait } from '../src/lib/route/departForecast';

// F1-64: the forecast download starts before the wait for the shapes, not after it.
describe('startThenWait', () => {
  it('starts the download before the wait ends and gives its result after', async () => {
    const order: string[] = [];
    let open: () => void = () => {};
    const wait = new Promise<void>((r) => { open = () => { order.push('bentuk'); r(); }; });
    const got = startThenWait(() => { order.push('prakiraan dimulai'); return Promise.resolve(7); }, wait);
    await Promise.resolve();
    expect(order).toEqual(['prakiraan dimulai']);
    open();
    expect(await got).toBe(7);
    expect(order).toEqual(['prakiraan dimulai', 'bentuk']);
  });
  it('gives null without a download, and null when the download failed, after the wait', async () => {
    expect(await startThenWait(null, Promise.resolve())).toBeNull();
    expect(await startThenWait(() => Promise.reject(new Error('404')), new Promise((r) => setTimeout(r, 5)))).toBeNull();
  });
});
