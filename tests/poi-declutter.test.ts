import { describe, expect, it } from 'vitest';
import { MAX_RENDER_POINTS, MIN_GAP_PX, thinPoints } from '../src/lib/poiThin';
import { maxLabels } from '../src/lib/label-collision';

// F1-70: the complete POI packs must not pile up (Tristan, 18 Nov 2026): at most 40 markers, spaced apart, and 12 labels.
const pt = (i: number, lat: number, lng: number, prio: number) => ({ lat, lng, _priority: prio, poi: { id: `p${i}`, name: `Tempat ${i}` } });

function pxDist(a: { lat: number; lng: number }, b: { lat: number; lng: number }, z: number): number {
  const s = 256 * 2 ** z;
  const y = (lat: number) => { const t = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + t) / (1 - t)) / (4 * Math.PI)) * s; };
  return Math.hypot(((a.lng - b.lng) / 360) * s, y(a.lat) - y(b.lat));
}

describe('POI declutter', () => {
  it('keeps at most 40 markers, each at least the gap apart, from a dense town at z17', () => {
    const many = Array.from({ length: 3000 }, (_, i) => pt(i, -6.6 + (i % 60) * 0.0002, 106.8 + Math.floor(i / 60) * 0.0002, 14 + (i % 5)));
    const kept = thinPoints(many, 17);
    expect(kept.length).toBeLessThanOrEqual(MAX_RENDER_POINTS);
    expect(kept.length).toBeGreaterThan(20);
    for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) expect(pxDist(kept[i], kept[j], 17)).toBeGreaterThanOrEqual(MIN_GAP_PX - 1e-6);
  });

  it('prefers the more important place when two are too close', () => {
    const kept = thinPoints([pt(1, -6.6, 106.8, 18), pt(2, -6.60001, 106.80001, 14)], 17);
    expect(kept.map((k) => k.poi.id)).toEqual(['p2']);
  });

  it('keeps both places when they are far enough apart, and is stable for equal input', () => {
    const a = [pt(1, -6.6, 106.8, 15), pt(2, -6.6, 106.802, 15)];
    expect(thinPoints(a, 17)).toHaveLength(2);
    expect(thinPoints(a, 17).map((k) => k.poi.id)).toEqual(thinPoints([...a].reverse(), 17).map((k) => k.poi.id));
  });

  it('labels at most 12 places per view, none below z15 unless a filter is on', () => {
    for (const z of [13, 14, 15, 16, 17, 18, 19, 20]) {
      expect(maxLabels(z, false)).toBeLessThanOrEqual(12);
      expect(maxLabels(z, true)).toBeLessThanOrEqual(12);
    }
    expect(maxLabels(14, false)).toBe(0);
    expect(maxLabels(17, false)).toBe(12);
  });
});
