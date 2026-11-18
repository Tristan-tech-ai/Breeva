import { describe, expect, it } from 'vitest';
import { loadRegionFiles, type GetBytes } from '../src/lib/route/regionFiles';

// F1-53: the router's files are asked for together, not one after the other (each wait is about 2 s on slow 3G).
const enc = (s: string) => new TextEncoder().encode(s);
const region = { name: 'r', geometry: '2026-11' };

/** A fake network: records each request and answers only when the test releases it. */
function network(manifest = { run: '2026111800', cells: [0, 2] }, fail: string[] = []) {
  const asked: string[] = [];
  const waiting = new Map<string, () => void>();
  const get: GetBytes = (url) => {
    asked.push(url);
    return new Promise((resolve, reject) => {
      waiting.set(url, () => {
        if (fail.some((f) => url.includes(f))) reject(new Error(`404 ${url}`));
        else resolve(url.endsWith('manifest.json') ? enc(JSON.stringify(manifest)) : enc(url));
      });
    });
  };
  const release = (part: string) => { for (const [u, go] of waiting) if (u.includes(part)) { waiting.delete(u); go(); } };
  const releaseAll = () => { for (const [u, go] of [...waiting]) { waiting.delete(u); go(); } };
  return { get, asked, release, releaseAll };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('loadRegionFiles', () => {
  it('asks for graph, harga, school points and manifest before any of them arrives', async () => {
    const n = network();
    const p = loadRegionFiles('/f', region, n.get);
    await tick();
    expect(n.asked.sort()).toEqual(['/f/graphs/2026-11/r_inti2.bin', '/f/graphs/2026-11/r_schools.json', '/f/harga/2026-11/r.bin', '/f/v/r/manifest.json']);
    n.release('manifest.json');
    await tick(); await tick();
    // the cells follow the manifest at once, while the graph is still on its way
    expect(n.asked.filter((u) => u.includes('/2026111800/'))).toEqual(['/f/v/r/2026111800/0.bin', '/f/v/r/2026111800/2.bin']);
    n.releaseAll(); await tick(); n.releaseAll();
    const f = await p;
    expect(new TextDecoder().decode(f.graph)).toBe('/f/graphs/2026-11/r_inti2.bin');
    expect(f.shapesUrl).toBe('/f/graphs/2026-11/r_bentuk.bin'); // not asked for yet: after the rest (F1-56)
    expect(n.asked.some((u) => u.includes('_bentuk'))).toBe(false);
    expect([...f.cells.keys()]).toEqual([0, 2]);
    expect(f.harga).not.toBeNull(); expect(f.schools).not.toBeNull();
  });

  it('works without harga and school points', async () => {
    const n = network(undefined, ['harga/', '_schools.json']);
    const p = loadRegionFiles('/f', region, n.get);
    for (let i = 0; i < 4; i++) { await tick(); n.releaseAll(); }
    const f = await p;
    expect(f.harga).toBeNull(); expect(f.schools).toBeNull();
  });

  it('fails when the graph or the manifest fails', async () => {
    for (const bad of ['graphs/2026-11/r_inti2.bin', 'manifest.json']) {
      const n = network(undefined, [bad]);
      const outcome = loadRegionFiles('/f', region, n.get).then(() => null, (e: Error) => e.message);
      for (let i = 0; i < 4; i++) { await tick(); n.releaseAll(); }
      expect(await outcome).toContain('404');
    }
  });
});
