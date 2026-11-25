import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeLines } from '../src/lib/nasional/mvt';
import { asapUbin, JAM_LALIN, KODE_KELAS, VOLUME_KELAS } from '../src/lib/nasional/asapRuas';

const tile = decodeLines(new Uint8Array(readFileSync('tests/fixtures/jalan_14_14595_8307.mvt')), 'jalan', 14, 14595, 8307);
const median = (a: number[]) => { const q = [...a].sort((x, y) => x - y); return q[Math.floor(q.length / 2)]; };

describe('N-21 exhaust per road on the phone', () => {
  it('keeps the builder hour curve (a server module) word for word', () => {
    const src = readFileSync('api/vayu/road-aqi.ts', 'utf8');
    const block = /HOURLY_TRAFFIC: Record<number, number> = \{([\s\S]*?)\};/.exec(src)![1];
    const orig = Object.fromEntries([...block.matchAll(/(\d+):\s*([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
    expect(JAM_LALIN).toEqual(orig);
  });
  it('has a volume for every class code of the national tiles', () => {
    for (const h of Object.values(KODE_KELAS)) expect(VOLUME_KELAS[h]).toBeDefined();
  });
  it('gives one value per road line of the tile, busier classes higher, at the morning peak more than at night', () => {
    const t0 = performance.now();
    const pagi = asapUbin(tile, [], 8, null, 0);
    const ms = performance.now() - t0;
    expect(pagi).toHaveLength(263);
    expect(pagi.every((r) => r.nox >= 0 && Number.isFinite(r.nox))).toBe(true);
    const by = (k: number) => median(pagi.filter((r) => r.k === k).map((r) => r.nox));
    expect(by(4)).toBeGreaterThan(by(9)); // secondary above service roads
    const malam = asapUbin(tile, [], 3, null, 0);
    expect(median(malam.map((r) => r.nox))).toBeLessThan(median(pagi.map((r) => r.nox)));
    expect(ms).toBeLessThan(3000);
  });
});
