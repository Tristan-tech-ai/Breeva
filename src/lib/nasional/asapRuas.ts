/**
 * N-21: vehicle exhaust per road anywhere in Indonesia, computed on the phone from the national road tiles (class only)
 * with the same kernel as the pilot map (src/lib/field/exhaust.ts) and the national wind. Indicative: traffic is the
 * pilot median of the road class, not counted traffic; no street canyons; links share their road's class.
 */
import { exhaustAt, isMajor, mixingHalfWidth, splitCarriagewayShare, urbanStability, type ExhaustSource, type Stability } from '../field/exhaust';
import { pasquillClass } from '../../../api/vayu/_caline4';
import { windAt, type WindFile } from './angin';
import type { MvtLine } from './mvt';

import { KODE_KELAS } from './ubinView';

export { KODE_KELAS };

/** Median per class of the two pilot packs 2026-11 (Badung-Denpasar 60,961 and Kota Bogor 19,362 roads): vehicles per
 * hour before the hour curve (traffic_base_estimate x calibration), road-class factor, carriageway width in metres.
 * Source: D:/breeva-ml-data/nasional/volume_kelas.json (.claude/loop/nasional/volume_kelas.ts, 25 Nov 2026). */
export const VOLUME_KELAS: Record<string, { veh: number; factor: number; width: number }> = {
  motorway: { veh: 2400, factor: 1.25, width: 10.5 },
  trunk: { veh: 1500, factor: 1.2, width: 7 },
  primary: { veh: 1000, factor: 1, width: 7 },
  secondary: { veh: 600, factor: 0.75, width: 7 },
  tertiary: { veh: 300, factor: 0.7, width: 5.5 },
  unclassified: { veh: 150, factor: 0.3, width: 4 },
  residential: { veh: 100, factor: 0.25, width: 4 },
  living_street: { veh: 50, factor: 0.15, width: 3.5 },
  service: { veh: 30, factor: 0.15, width: 3 },
};

/** The builder's hour-of-day traffic curve (copy of HOURLY_TRAFFIC in api/vayu/road-aqi.ts, a server module; a test
 * keeps the two equal). */
export const JAM_LALIN: Record<number, number> = {
  0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.12, 5: 0.35, 6: 0.85, 7: 1.20, 8: 1.40, 9: 1.10, 10: 0.90, 11: 0.95,
  12: 1.15, 13: 1.10, 14: 0.85, 15: 0.90, 16: 1.20, 17: 1.50, 18: 1.60, 19: 1.30, 20: 1.10, 21: 0.80, 22: 0.55, 23: 0.30,
};

export interface RuasAsap { coords: Array<[number, number]>; k: number; nox: number; pm25: number }

/** Every line of the tiles as an exhaust source at this hour (one line = one road piece). */
export function sumberNasional(lines: MvtLine[], hourLocal: number): { sources: ExhaustSource[]; kelas: number[] } {
  const coords: Array<Array<[number, number]>> = [], kelas: number[] = [];
  for (const f of lines) for (const l of f.lines) { coords.push(l); kelas.push(Number(f.props.k) || 7); }
  const hw = kelas.map((k) => KODE_KELAS[k] ?? 'residential');
  const share = splitCarriagewayShare(coords, hw);
  const diurnal = JAM_LALIN[hourLocal] ?? 1;
  return {
    kelas,
    sources: coords.map((c, i) => {
      const v = VOLUME_KELAS[hw[i]] ?? VOLUME_KELAS.residential;
      return { coords: c, vehPerHour: v.veh * diurnal * v.factor * share[i], mod: 1, halfW: mixingHalfWidth(v.width), major: isMajor(hw[i]) };
    }),
  };
}

/**
 * Exhaust at the middle of each road of the centre tile, with the roads of the centre and its neighbours as sources
 * (the kernel reaches 500 m; a z14 tile is about 2.4 km). Wind from the national file at that hour (2 m/s without it),
 * stability as the pilot builder sets it.
 */
export function asapUbin(centre: MvtLine[], neighbours: MvtLine[], hourLocal: number, wind: WindFile | null, windHour: number): RuasAsap[] {
  const all = sumberNasional([...centre, ...neighbours], hourLocal);
  const nCentre = centre.reduce((a, f) => a + f.lines.length, 0);
  const receptors = all.sources.slice(0, nCentre).map((s) => { const m = s.coords[Math.floor(s.coords.length / 2)]; return { lat: m[1], lon: m[0] }; });
  const met = (lat: number, lon: number) => {
    const w = wind ? windAt(wind, lon, lat, windHour) : null;
    const ws = w && Number.isFinite(w.speed) ? w.speed : 2.0;
    return { wind: ws, stability: urbanStability(pasquillClass(ws, hourLocal, 0.5) as Stability, hourLocal) };
  };
  const r = exhaustAt(all.sources, receptors, met);
  return r.map((x, i) => ({ coords: all.sources[i].coords as Array<[number, number]>, k: all.kelas[i], nox: Math.round(x.nox * 100) / 100, pm25: Math.round(x.pm25 * 1000) / 1000 }));
}
