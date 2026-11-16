import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WalkGraph } from '../src/lib/route/walkGraph';
import { route } from '../src/lib/route/router';
import { accessZone, EMISSION_SHARE, isLocal, motorAllowedClass, motorNode, motorRoute, optionsFor } from '../src/lib/route/cost';

// 3 x 3 grid of the Python writer; classes cycle residential, footway, steps, primary
const g = new WalkGraph(new Uint8Array(readFileSync('tests/fixtures/graph_small.bin')));
const no2 = Float64Array.from({ length: g.m }, (_, e) => 10 + (e % 5));
const harga = Float64Array.from({ length: g.m }, (_, e) => (e % 3) + 0.5);

describe('route cost by mode', () => {
  it('walking ignores harga hirup (no emission) and uses the walking speed', () => {
    const o = optionsFor(g, 'walk', 0, 8, { no2, harga });
    expect(o.speed).toBe(1.3);
    expect(o.imposedOf).toBeUndefined();
    expect(EMISSION_SHARE.walk).toBe(0);
  });

  it('motor routes never use footways or steps, and local streets only inside the access zone', () => {
    const pairs: Array<[number, number]> = [];
    for (let s = 0; s < g.n; s++) for (let t = 0; t < g.n; t++) if (s !== t && motorNode(g, s) && motorNode(g, t)) pairs.push([s, t]);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [s, t] of pairs) {
      for (const accessM of [0, 50, 500]) {
        const o = optionsFor(g, 'motor', s, t, { no2, harga }, false, accessM);
        const r = route(g, s, t, 1, o);
        if (!r) continue;
        const zone = accessZone(g, s, t, accessM);
        for (const e of r.edges) {
          expect(motorAllowedClass(g, e)).toBe(true);
          if (isLocal(g, e)) expect(zone[e]).toBe(1);
        }
        expect(r.imposed).toBeGreaterThan(0);   // the exposure the trip imposes is always reported
      }
    }
  });

  it('the emergency option has no harga hirup in its cost but keeps the zona napas', () => {
    const s = [...Array(g.n).keys()].find((u) => motorNode(g, u))!;
    const t = [...Array(g.n).keys()].reverse().find((u) => motorNode(g, u) && u !== s)!;
    const o = optionsFor(g, 'motor', s, t, { no2, harga }, true, 50);
    expect(o.lambda).toBe(0);
    const zone = accessZone(g, s, t, 50);
    const r = route(g, s, t, 0, o);
    if (r) for (const e of r.edges) if (isLocal(g, e)) expect(zone[e]).toBe(1);
    const both = motorRoute(route, g, 'motor', s, t, { no2, harga }, true);
    expect(both === null || both.accessM >= 500).toBe(true);
  });
});
