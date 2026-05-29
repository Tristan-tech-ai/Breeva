// ═══════════════════════════════════════════════════════════════════════════════
// _caline4.ts — CALINE4 v2 dispersion stack (shared, underscore-prefixed).
//
// WHY underscore: a leading underscore makes Vercel treat this as a NON-route module,
// so the bundler INLINES it into any handler that imports it (e.g. road-aqi.ts) and
// cross-handler value imports resolve at runtime. Importing the same functions from
// route-score.ts (a NON-underscore API route = its own function) left an external
// `./route-score` reference that failed with ERR_MODULE_NOT_FOUND at runtime and
// crashed road-aqi (2026-05-29). Same lesson as the inlined _ml_inference.ts.
//
// This is a VERBATIM copy of the parity-tested CALINE4 block in route-score.ts (so
// road-aqi's dispersion output stays byte-identical to the validated implementation
// — see scripts/test_caline4_polyline_parity.py).
// TODO(dedup): make route-score.ts import from here too and delete its copy.
// ═══════════════════════════════════════════════════════════════════════════════

// --- Per-vehicle-class emission factors (g/km) ---
// B4 update applied: motor_4tak calibrated to ICCT TRUE Jakarta 2022 real-world
// remote sensing of 93,000+ vehicles in Greater Jakarta (Jan-Apr 2021).
type CalineEmissionFactor = { nox: number; pm25: number; co: number };

const CALINE4_EMISSION_FACTORS: Record<string, CalineEmissionFactor> = {
  motor_2tak:   { nox:  0.35, pm25: 0.09, co: 14.2 },  // legacy 2-stroke; rare in 2021+ Jakarta fleet
  motor_4tak:   { nox:  0.46, pm25: 0.01, co:  1.95 }, // ICCT TRUE Jakarta 2022 (modern Euro4 catalytic; soot ≈ 0)
  mobil_bensin: { nox:  0.62, pm25: 0.03, co:  8.1 },
  mobil_diesel: { nox:  1.15, pm25: 0.12, co:  1.2 },
  angkot:       { nox:  2.40, pm25: 0.45, co:  4.5 },
  bus:          { nox:  8.20, pm25: 1.10, co:  3.8 },  // Lestari 2022 confirms HDV dominates urban PM2.5 (43%)
  truk:         { nox: 11.50, pm25: 1.40, co:  4.2 },
  sepeda:       { nox:  0.00, pm25: 0.00, co:  0.0 },
};

// --- Indonesia fleet composition weights (caline3.py:45-53) ---
const CALINE4_FLEET_WEIGHTS: Record<string, number> = {
  motor_2tak:   0.15,
  motor_4tak:   0.45,
  mobil_bensin: 0.25,
  mobil_diesel: 0.05,
  angkot:       0.05,
  bus:          0.02,
  truk:         0.03,
};

// --- Computed fleet-average emission factor ---
export const CALINE4_FLEET_AVG: CalineEmissionFactor = (() => {
  let nox = 0, pm25 = 0, co = 0;
  for (const [k, w] of Object.entries(CALINE4_FLEET_WEIGHTS)) {
    const ef = CALINE4_EMISSION_FACTORS[k];
    nox  += ef.nox  * w;
    pm25 += ef.pm25 * w;
    co   += ef.co   * w;
  }
  return { nox, pm25, co };
})();

// --- Pasquill-Gifford stability classes A-F (Martin 1976 simplified power-law form) ---
type CalinePGCoeffs = { ay: number; by: number; az: number; bz: number };

const CALINE4_PG_CLASSES: Record<string, CalinePGCoeffs> = {
  A: { ay: 0.22, by: 0.894, az: 0.20,  bz: 0.894 },
  B: { ay: 0.16, by: 0.894, az: 0.12,  bz: 0.894 },
  C: { ay: 0.11, by: 0.894, az: 0.08,  bz: 0.894 },
  D: { ay: 0.08, by: 0.894, az: 0.06,  bz: 0.894 },
  E: { ay: 0.06, by: 0.894, az: 0.03,  bz: 0.894 },
  F: { ay: 0.04, by: 0.894, az: 0.016, bz: 0.894 },
};

export type PasquillClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

// --- Pasquill stability classifier (caline3.py:82-106). cloud_cover is fraction 0-1. ---
export function pasquillClass(windSpeedMs: number, hourLocal: number, cloudCoverFrac: number = 0.5): PasquillClass {
  const isDay = hourLocal >= 6 && hourLocal <= 18;
  if (isDay) {
    if (windSpeedMs < 2.0) return cloudCoverFrac < 0.5 ? 'A' : 'B';
    if (windSpeedMs < 5.0) return cloudCoverFrac < 0.5 ? 'B' : 'C';
    return cloudCoverFrac < 0.5 ? 'C' : 'D';
  }
  // night
  if (windSpeedMs < 2.0) return 'F';
  if (windSpeedMs < 3.0) return 'E';
  return 'D';
}

// --- Multi-class σy/σz (Martin 1976 baseline) ---
export function caline4SigmaY(downwindM: number, stab: PasquillClass): number {
  const pg = CALINE4_PG_CLASSES[stab];
  return pg.ay * Math.pow(Math.max(downwindM, 1.0), pg.by);
}

export function caline4SigmaZ(downwindM: number, stab: PasquillClass): number {
  const pg = CALINE4_PG_CLASSES[stab];
  return pg.az * Math.pow(Math.max(downwindM, 1.0), pg.bz);
}

// ─────────────────────────────────────────────────────────────────────────────
// B2 — Wind rotation in local ENU (East-North-Up) tangent frame
// ─────────────────────────────────────────────────────────────────────────────
const ENU_METERS_PER_DEG_LAT = 110574;
const ENU_METERS_PER_DEG_LON_EQUATORIAL = 111320;

type CalineRelativeCoords = {
  downwindM: number;   // positive = receptor downwind of source; ≤0 → contribution zero
  crosswindM: number;  // signed lateral offset
  distM: number;       // total ENU distance source→receptor (always ≥ 0)
};

export function caline4WindRotation(
  srcLat: number,
  srcLon: number,
  recvLat: number,
  recvLon: number,
  windFromDeg: number,
): CalineRelativeCoords {
  const cosLat = Math.cos((srcLat * Math.PI) / 180);
  const dxM = (recvLon - srcLon) * cosLat * ENU_METERS_PER_DEG_LON_EQUATORIAL;
  const dyM = (recvLat - srcLat) * ENU_METERS_PER_DEG_LAT;
  const distM = Math.hypot(dxM, dyM);

  const windRad = (windFromDeg * Math.PI) / 180;
  const wx = -Math.sin(windRad);
  const wy = -Math.cos(windRad);

  const downwindM = dxM * wx + dyM * wy;
  const crosswindM = -dxM * wy + dyM * wx;

  return { downwindM, crosswindM, distM };
}

// ─────────────────────────────────────────────────────────────────────────────
// B3 — CALINE4 line-source erf integral (Benson 1989 FHWA-RD-83-007)
// ─────────────────────────────────────────────────────────────────────────────
/** erf(x) — Gauss error function polyfill (Abramowitz & Stegun §7.1.26). Max abs error 1.5e-7. */
export function mathErf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + p * ax);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  const series = a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5;
  const y = 1.0 - series * Math.exp(-ax * ax);
  return sign * y;
}

const CALINE4_RECEPTOR_HEIGHT_M = 1.5;
const CALINE4_SOURCE_HEIGHT_M = 0.5;
const CALINE4_MIN_WIND_MS = 0.5;
const CALINE4_MIXING_ZONE_SIGMA_Z0_M = 5.5;
const CALINE4_MIXING_ZONE_WIDTH_M = 30;

export function caline4DepressedDSTRFactor(absLinkHeightM: number): number {
  if (absLinkHeightM <= 0) return 1.0;  // not depressed
  return 0.72 * Math.pow(absLinkHeightM, 0.83);
}

/** Effective σz0 (mixing-zone initial vertical dispersion) for a road section. */
export function caline4SigmaZ0ForSection(linkHeightM: number): number {
  if (linkHeightM >= 0) return CALINE4_MIXING_ZONE_SIGMA_Z0_M;  // AG or elevated
  const dstr = caline4DepressedDSTRFactor(Math.abs(linkHeightM));
  return CALINE4_MIXING_ZONE_SIGMA_Z0_M * Math.sqrt(dstr);
}

/** CALINE4 line-source dispersion contribution from ONE polyline sub-segment (µg/m³). */
export function caline4LineSourceConc(
  qLineUgPerMS: number,
  subSegLengthM: number,
  subSegMidLat: number,
  subSegMidLon: number,
  recvLat: number,
  recvLon: number,
  windSpeedMs: number,
  windFromDeg: number,
  stab: PasquillClass,
): number {
  if (qLineUgPerMS <= 0 || subSegLengthM <= 0) return 0;

  const { downwindM, crosswindM } = caline4WindRotation(
    subSegMidLat, subSegMidLon, recvLat, recvLon, windFromDeg,
  );

  if (downwindM <= 0) return 0;

  const xResidual = Math.max(0, downwindM - CALINE4_MIXING_ZONE_WIDTH_M / 2);
  const sigmaY = caline4SigmaY(xResidual, stab);
  const sigmaZPasquill = caline4SigmaZ(xResidual, stab);
  const sigmaZ = Math.sqrt(
    CALINE4_MIXING_ZONE_SIGMA_Z0_M * CALINE4_MIXING_ZONE_SIGMA_Z0_M
    + sigmaZPasquill * sigmaZPasquill,
  );
  if (sigmaY <= 0 || sigmaZ <= 0) return 0;

  const u = Math.max(windSpeedMs, CALINE4_MIN_WIND_MS);

  const sqrt2sy = Math.SQRT2 * sigmaY;
  const alphaPlus  = (crosswindM + subSegLengthM / 2) / sqrt2sy;
  const alphaMinus = (crosswindM - subSegLengthM / 2) / sqrt2sy;
  const lateralIntegral = 0.5 * (mathErf(alphaPlus) - mathErf(alphaMinus));
  if (lateralIntegral <= 0) return 0;

  const z = CALINE4_RECEPTOR_HEIGHT_M;
  const H = CALINE4_SOURCE_HEIGHT_M;
  const twoSz2 = 2 * sigmaZ * sigmaZ;
  const verticalDirect  = Math.exp(-((z - H) * (z - H)) / twoSz2);
  const verticalMirror  = Math.exp(-((z + H) * (z + H)) / twoSz2);
  const Rground = verticalDirect + verticalMirror;

  const concentration = (qLineUgPerMS / (Math.sqrt(2 * Math.PI) * sigmaZ * u))
                      * lateralIntegral
                      * Rground;

  return Math.max(0, concentration);
}

/** Integrate CALINE4 contributions across a multi-vertex polyline. coords = [[lon,lat],...]. */
export function caline4PolylineConc(
  polylineCoords: ReadonlyArray<readonly [number, number]>,
  qLineUgPerMS: number,
  recvLat: number,
  recvLon: number,
  windSpeedMs: number,
  windFromDeg: number,
  stab: PasquillClass,
): number {
  if (polylineCoords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < polylineCoords.length - 1; i++) {
    const [lon1, lat1] = polylineCoords[i];
    const [lon2, lat2] = polylineCoords[i + 1];
    const cosLat = Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
    const dxM = (lon2 - lon1) * cosLat * ENU_METERS_PER_DEG_LON_EQUATORIAL;
    const dyM = (lat2 - lat1) * ENU_METERS_PER_DEG_LAT;
    const subSegLengthM = Math.hypot(dxM, dyM);
    if (subSegLengthM < 1.0) continue;
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;
    total += caline4LineSourceConc(
      qLineUgPerMS, subSegLengthM, midLat, midLon, recvLat, recvLon,
      windSpeedMs, windFromDeg, stab,
    );
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// B5 — Post-Gaussian modifiers: OSPM canyon + sea-breeze diurnal + wet/dry
// ─────────────────────────────────────────────────────────────────────────────
const CALINE4_CANYON_ALPHA = 0.8;
const CALINE4_CANYON_NEUTRAL = 1.0;
const CALINE4_CANYON_CAP = 3.0;
const CALINE4_CANYON_MICRO_CLASSES = new Set(['canyon', 'arterial', 'collector', 'highway']);

export function caline4CanyonFactor(canyonRatio: number | null, microClass: string | null): number {
  if (canyonRatio == null || canyonRatio <= 0) return 1.0;
  if (!microClass || !CALINE4_CANYON_MICRO_CLASSES.has(microClass)) return 1.0;
  const factor = 1.0 + CALINE4_CANYON_ALPHA * (canyonRatio - CALINE4_CANYON_NEUTRAL);
  return Math.max(0.5, Math.min(factor, CALINE4_CANYON_CAP));
}

const SEABREEZE_DIURNAL_LOOKUP: Record<number, number> = {
  0: 0.85, 1: 0.80, 2: 0.80, 3: 0.80, 4: 0.85, 5: 0.90,
  6: 1.00, 7: 1.00, 8: 1.05,
  9: 1.15, 10: 1.20, 11: 1.20, 12: 1.20, 13: 1.20, 14: 1.20,
  15: 1.15, 16: 1.10, 17: 1.05, 18: 1.00,
  19: 0.95, 20: 0.90, 21: 0.85, 22: 0.80, 23: 0.80,
};

const SEABREEZE_COASTAL_THRESHOLD_M = 10_000;

export function caline4SeabreezeFactor(
  distanceFromCoastM: number | null,
  hourLocal: number,
): number {
  if (distanceFromCoastM == null || distanceFromCoastM > SEABREEZE_COASTAL_THRESHOLD_M) return 1.0;
  const hour = ((hourLocal % 24) + 24) % 24;
  const lookup = SEABREEZE_DIURNAL_LOOKUP[Math.floor(hour)];
  return lookup ?? 1.0;
}

const WET_SEASON_MONTHS = new Set([11, 12, 1, 2, 3, 4]);

export function caline4WetDryFactor(monthLocal: number): number {
  const m = ((monthLocal - 1) % 12) + 1;  // 1-12
  return WET_SEASON_MONTHS.has(m) ? 0.75 : 1.10;
}

/** Convenience: apply all three modifiers. */
export function caline4ApplyModifiers(
  baseConc: number,
  opts: {
    canyonRatio: number | null;
    microClass: string | null;
    distanceFromCoastM: number | null;
    hourLocal: number;
    monthLocal: number;
  },
): number {
  if (baseConc <= 0) return 0;
  const fCanyon = caline4CanyonFactor(opts.canyonRatio, opts.microClass);
  const fSeabreeze = caline4SeabreezeFactor(opts.distanceFromCoastM, opts.hourLocal);
  const fWet = caline4WetDryFactor(opts.monthLocal);
  return baseConc * fCanyon * fSeabreeze * fWet;
}
