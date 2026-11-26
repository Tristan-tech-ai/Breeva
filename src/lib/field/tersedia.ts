/**
 * M-U03: what /peta can honestly draw. The static field has PM2.5 and NO2 (total and exhaust part) and the harga hirup;
 * it has no O3 and no PM10, which earlier fell back to PM2.5 without saying so. Outside the pilot regions only the
 * exhaust computed on the phone exists (NOx from the road class, indicative, from zoom 13).
 */
import type { PollutantType, RoadDisplayMode } from '../../types';

export interface Tersedia { polutan: ReadonlySet<PollutantType>; mode: ReadonlySet<RoadDisplayMode>; alasan: string }

const SEMUA_P: PollutantType[] = ['aqi', 'pm25', 'no2', 'o3', 'pm10'];
const SEMUA_M: RoadDisplayMode[] = ['traffic', 'total', 'harga'];
const cache = new Map<string, Tersedia>();

export function tersediaDiPeta(fieldStatic: boolean, luarPilot: boolean): Tersedia {
  const key = `${fieldStatic}|${luarPilot}`;
  const hit = cache.get(key);
  if (hit) return hit; // the same object for the same inputs (React effect dependencies)
  let t: Tersedia;
  if (!fieldStatic) t = { polutan: new Set(SEMUA_P), mode: new Set(SEMUA_M), alasan: '' };
  else if (luarPilot) {
    t = {
      polutan: new Set<PollutantType>(['aqi', 'no2']),
      mode: new Set<RoadDisplayMode>(['traffic']),
      alasan: 'Di luar Badung–Denpasar dan Kota Bogor, peta hanya menghitung asap kendaraan (NO₂ dari knalpot, indikatif) mulai zoom 13; udara total, harga hirup, PM₂.₅, PM₁₀, dan O₃ belum ada di sini.',
    };
  } else {
    t = {
      polutan: new Set<PollutantType>(['aqi', 'pm25', 'no2']),
      mode: new Set(SEMUA_M),
      alasan: 'O₃ dan PM₁₀ belum dihitung per ruas jalan.',
    };
  }
  cache.set(key, t);
  return t;
}
