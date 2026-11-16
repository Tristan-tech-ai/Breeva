import { describe, expect, it } from 'vitest';
import { closureEffect, closureText, imposedOnDetour, unitContributions } from '../src/lib/policy/closure';
import { mixingHalfWidth, type ExhaustSource, type Stability } from '../src/lib/field/exhaust';

const lat0 = -8.67, lon0 = 115.21, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
// a north-south road at x = dx metres from the gate, 600 m long
const road = (dxM: number, veh: number, lengthM = 600): ExhaustSource => ({
  coords: [[lon0 + dxM / mLon, lat0 - lengthM / 2 / 110574], [lon0 + dxM / mLon, lat0 + lengthM / 2 / 110574]],
  vehPerHour: veh, mod: 1, halfW: mixingHalfWidth(6), major: false,
});
const met = { wind: 1.5, stability: 'D' as Stability };
const gate = { lat: lat0, lon: lon0 + 8 / mLon }; // 8 m from the gate road

describe('closing the road at a school gate', () => {
  // 0: the gate road (400 veh/h), 1: a parallel street 120 m away (the detour), 2: a far trunk road 450 m away
  const sources = [road(0, 400), road(120, 300), road(450, 2000)];
  const veh = (j: number) => sources[j].vehPerHour;
  const unit = unitContributions(sources, gate, met);

  it('unit contributions fall with distance and add up to the exhaust at the gate', () => {
    expect(unit.get(0)!).toBeGreaterThan(unit.get(1)!);
    expect(unit.get(1)!).toBeGreaterThan(unit.get(2)!);
    const e = closureEffect(unit, veh, [], []);
    expect(e.before).toBeCloseTo(unit.get(0)! * 400 + unit.get(1)! * 300 + unit.get(2)! * 2000, 9);
  });

  it('moving the gate traffic one street over cuts the exhaust at the gate, and the detour gets that traffic', () => {
    const e = closureEffect(unit, veh, [0], [1]);
    expect(e.moved).toBe(400);
    expect(e.after).toBeCloseTo(e.before - unit.get(0)! * 400 + unit.get(1)! * 400, 9);
    expect(e.pct).toBeLessThan(-40);
    // the street that takes the traffic breathes more: its own unit contribution times 400 vehicles
    const self = unitContributions(sources, { lat: lat0, lon: lon0 + 128 / mLon }, met, [1]).get(1)!;
    const imp = imposedOnDetour(() => self, e.moved, [1], () => 1.3);
    expect(imp.maxAt).toBe(1);
    expect(imp.maxRise).toBeCloseTo(self * 400, 9);
    expect(imp.weighted).toBeCloseTo(self * 400 * 1.3, 9);
  });

  it('a detour that passes the gate as well gives back part of the gain; an empty gate road changes nothing', () => {
    const near = closureEffect(unit, veh, [0], [1]), viaGate = closureEffect(unit, veh, [0], [0, 1]);
    expect(viaGate.after).toBeCloseTo(near.after, 9); // the closed road itself is never part of the detour
    const empty = closureEffect(unit, (j) => (j === 0 ? 0 : veh(j)), [0], [1]);
    expect(empty.pct).toBe(0);
    expect(closureText(empty, 0, 0, null)).toBe('Jalan depan sekolah ini hampir tanpa kendaraan; menutupnya tidak mengubah asap di gerbang.');
  });

  it('says it in one line', () => {
    expect(closureText({ before: 40, after: 12, pct: -70, moved: 400 }, 180, 6.25, 'Jalan Sudirman'))
      .toBe('Asap kendaraan di gerbang turun 70%, kendaraan pindah ke Jalan Sudirman (asap di sana +6,3 µg/m³); jalan putar 180 m lebih jauh.');
  });
});
