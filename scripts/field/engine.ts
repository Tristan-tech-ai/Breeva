/**
 * The per-road computation used by the field builder and the parity check. It calls the service engine functions
 * (computeRoadAQIv2, buildMultiSourceDeltas from api/vayu/road-aqi.ts) and never re-implements them.
 */
import { buildMultiSourceDeltas, computeRoadAQIv2, pm25ToAQI, type RoadRow } from '../../api/vayu/road-aqi.js';
import { buildInterpolator, type BaselineCorners, type BaselineData } from '../../api/vayu/_baseline.js';
import { caline4CanyonFactor, pasquillClass } from '../../api/vayu/_caline4.js';
import { exhaustAt, isMajor, mixingHalfWidth, splitCarriagewayShare, urbanStability, type ExhaustSource, type Stability } from '../../src/lib/field/exhaust.js';
import type { RoadPack } from './pack.js';
import type { CellValue } from './cells.js';
import { intervalSd, OrdinaryKriging } from './kriging.js';
import type { MeasuredInputs } from './measure.js';

/** Everything the computation depends on, saved with each run so it can be recomputed exactly. */
export interface FieldInputs {
  region: string;            // engine region key, e.g. 'bali'
  hourLocal: number;
  monthLocal: number;
  diurnal: number;
  camsDaily: number;
  /** One background grid per pack cell, as fetched from Open-Meteo. */
  grids: Array<{ cell: number; corners: BaselineCorners; bounds: { south: number; west: number; north: number; east: number } }>;
  /** Measurement layer of the hour (scripts/field/measure.ts); absent in runs built before task F2-07. */
  measured?: MeasuredInputs;
  /**
   * Traffic part: 'iso1' = direction-averaged urban kernel (src/lib/field/exhaust.ts); absent = the service engine's
   * single-direction sum of the 40 nearest roads (runs built before 16 Nov 2026, and the parity check).
   */
  exhaust?: 'iso1';
  /** Live congestion: multiplier on a road's vehicles per hour, by road index; roads not listed use 1. */
  congestion?: Record<number, number>;
}

/**
 * Road-class factor on traffic where a road has no classified factor: the median classified factor of that class in
 * the Badung-Denpasar pack of 2026-11 (60,961 roads, all classified). One table for every region, no random spread.
 */
export const CLASS_FACTOR: Record<string, number> = {
  motorway: 1.25, motorway_link: 1.2, trunk: 1.2, trunk_link: 1.15, primary: 1, primary_link: 0.71,
  secondary: 0.75, secondary_link: 0.7, tertiary: 0.7, tertiary_link: 0.75, unclassified: 0.3,
  residential: 0.25, living_street: 0.15, service: 0.15,
};

/** Exhaust sources of a pack at one hour: vehicles per hour = class estimate x hour curve x class factor x congestion. */
export function exhaustSources(rows: RoadRow[], coordsOf: (k: number) => number[][], diurnal: number, congestion?: Record<number, number>): ExhaustSource[] {
  const coords = rows.map((_, k) => coordsOf(k));
  // one half of a dual carriageway carries half the class volume (otherwise the corridor is counted twice)
  const share = splitCarriagewayShare(coords, rows.map((r) => r.highway || 'residential'));
  return rows.map((r, k) => {
    const highway = r.highway || 'residential';
    const factor = r.ai_pollution_factor ?? CLASS_FACTOR[highway] ?? 0.25;
    return {
      coords: coords[k],
      vehPerHour: (r.traffic_base_estimate ?? 100) * (r.traffic_calibration_factor || 1) * diurnal * factor * share[k] * (congestion?.[k] ?? 1),
      mod: caline4CanyonFactor(r.canyon_ratio, r.micro_class),
      halfW: mixingHalfWidth(r.width),
      major: isMajor(highway),
    };
  });
}

/** Sensors closer than this to a road make its value 'high' confidence (hidden-sensor error by distance, stats_i.json). */
export const HIGH_CONFIDENCE_KM = 2;

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Replace the engine's ambient (background + spatial residual) with the measurement layer, keeping the per-road
 * dispersion increment pm25_delta on top:
 *   kriging      ambient = expm1(OK estimate of log1p PM2.5 at the road midpoint); 95 % interval from the kriging variance;
 *   koschmieder  ambient = max(engine ambient, visibility estimate) (the 'lin_kosch_maks' choice of analysis F); the
 *                engine's interval width is kept and confidence is low, since one airport stands for the whole region.
 */
export function makeMeasuredAdjust(m: MeasuredInputs | undefined) {
  if (!m || m.method === 'none') return null;
  if (m.method === 'kriging') {
    if (!m.variogram_log || !m.sensors.length) throw new Error('kriging inputs without sensors or variogram');
    const ok = new OrdinaryKriging(m.sensors, m.variogram_log);
    const vals = m.sensors.map((s) => Math.log1p(s.pm25));
    const k = m.pi_scale ?? 1; // interval calibration from the hidden-sensor test (1 in runs built before it)
    const floor = m.noise_floor_ugm3 ?? 0; // F5-30 sensor noise floor (0 in runs built before it)
    return (lat: number, lon: number, v: { pm25: number; pm25_delta: number; pi95_hi: number; ood_refused: boolean; confidence: CellValue['confidence'] }) => {
      const r = ok.predict(vals, lat, lon);
      const sd = intervalSd(r.variance, r.mean, k, floor);
      const pm25 = r2(Math.max(0, Math.expm1(r.mean) + v.pm25_delta));
      return {
        pm25, pi95_lo: r2(Math.max(0, Math.expm1(r.mean - 1.96 * sd) + v.pm25_delta)),
        pi95_hi: r2(Math.min(500, Math.expm1(r.mean + 1.96 * sd) + v.pm25_delta)),
        confidence: (v.ood_refused ? v.confidence : r.nearest_km <= HIGH_CONFIDENCE_KM ? 'high' : 'medium') as CellValue['confidence'],
      };
    };
  }
  const k = m.koschmieder;
  if (!k) throw new Error('koschmieder inputs without an estimate');
  return (_lat: number, _lon: number, v: { pm25: number; pm25_delta: number; pi95_hi: number; ood_refused: boolean; confidence: CellValue['confidence'] }) => {
    const pm25 = r2(Math.max(v.pm25, k.pm25 + v.pm25_delta));
    const half = Math.max(0, v.pi95_hi - v.pm25);
    return { pm25, pi95_lo: r2(Math.max(0, pm25 - half)), pi95_hi: r2(Math.min(500, pm25 + half)), confidence: 'low' as const };
  };
}

export function roadRow(p: RoadPack, k: number): RoadRow {
  return {
    osm_way_id: p.col('osm_way_id')[k],
    geojson: JSON.stringify({ type: 'LineString', coordinates: p.coords(k) }),
    highway: p.highway(k),
    lanes: p.num('lanes', k), width: p.num('width', k), canyon_ratio: p.num('canyon_ratio', k),
    landuse_proxy: p.str('landuse_proxy', k),
    traffic_base_estimate: p.num('traffic_base_estimate', k) ?? 100,
    traffic_calibration_factor: p.num('traffic_calibration_factor', k) ?? 1,
    name: p.str('name', k), surface: p.str('surface', k), elevation_avg: p.num('elevation_avg', k),
    micro_class: p.str('micro_class', k), ai_pollution_factor: p.num('ai_pollution_factor', k),
  };
}

/**
 * Traffic NOx per road (pack order) for another hour: the forecast wind of `grids` and that hour's traffic curve,
 * with the kernel and sources of the run itself. Used for the departure-time forecast files (BXF1).
 */
export function exhaustForHour(p: RoadPack, grids: FieldInputs['grids'], hourLocal: number, diurnal: number): Float64Array {
  const rows = Array.from({ length: p.n }, (_, k) => roadRow(p, k));
  const interp = makeInterp(p, { grids } as FieldInputs);
  const met = (lat: number, lon: number) => {
    const b = interp(lat, lon);
    const ws = Number.isFinite(b.wind_speed) ? b.wind_speed : 2.0;
    return { wind: ws, stability: urbanStability(pasquillClass(ws, hourLocal, 0.5) as Stability, hourLocal) };
  };
  const mids = rows.map((_, k) => { const c = p.coords(k); const m = c[Math.floor(c.length / 2)]; return { lat: m[1], lon: m[0] }; });
  const r = exhaustAt(exhaustSources(rows, (k) => p.coords(k), diurnal), mids, met);
  return Float64Array.from(r, (x) => x.nox);
}

/** Background interpolation: the grid of the z12 cell holding the point (nearest cell centre outside all cells). */
export function makeInterp(p: RoadPack, inputs: FieldInputs): (lat: number, lon: number) => BaselineData {
  const z = p.meta.cell_zoom;
  const interps = new Map<number, (lat: number, lon: number) => BaselineData>();
  for (const g of inputs.grids) interps.set(g.cell, buildInterpolator(g.bounds.south, g.bounds.west, g.bounds.north, g.bounds.east, g.corners));
  const cellOf = new Map(p.meta.cells.map(([x, y], c) => [`${x}:${y}`, c]));
  return (lat, lon) => {
    const n = 2 ** z;
    const fx = ((lon + 180) / 360) * n;
    const lr = (lat * Math.PI) / 180;
    const fy = ((1 - Math.asinh(Math.tan(lr)) / Math.PI) / 2) * n;
    let c = cellOf.get(`${Math.floor(fx)}:${Math.floor(fy)}`);
    if (c === undefined) {
      let best = Infinity;
      p.meta.cells.forEach(([x, y], k) => {
        const d = (x + 0.5 - fx) ** 2 + (y + 0.5 - fy) ** 2;
        if (d < best) { best = d; c = k; }
      });
    }
    const f = interps.get(c!);
    if (!f) throw new Error(`no background grid for cell ${c}`);
    return f(lat, lon);
  };
}

export interface RoadResult extends CellValue { k: number; aqi: number; pi95_lo: number; pi95_hi: number }

/** Values for the given road indexes (default: all), in pack order. Multi-source dispersion always uses the whole pack. */
export function computeField(p: RoadPack, inputs: FieldInputs, only?: number[]): RoadResult[] {
  const rows = Array.from({ length: p.n }, (_, k) => roadRow(p, k));
  const interp = makeInterp(p, inputs);
  const ks = only ?? rows.map((_, k) => k);
  const mids = ks.map((k) => { const c = p.coords(k); return c[Math.floor(c.length / 2)]; });
  let iso: Array<{ pm25: number; nox: number }> | null = null;
  let multi: Map<number, { pm25: number; nox: number }> | null = null;
  if (inputs.exhaust === 'iso1') {
    const met = (lat: number, lon: number) => {
      const b = interp(lat, lon);
      const ws = Number.isFinite(b.wind_speed) ? b.wind_speed : 2.0;
      return { wind: ws, stability: urbanStability(pasquillClass(ws, inputs.hourLocal, 0.5) as Stability, inputs.hourLocal) };
    };
    iso = exhaustAt(exhaustSources(rows, (k) => p.coords(k), inputs.diurnal, inputs.congestion), mids.map((m) => ({ lat: m[1], lon: m[0] })), met);
  } else {
    multi = buildMultiSourceDeltas(rows, interp, inputs.diurnal, inputs.hourLocal, inputs.monthLocal);
  }
  const adjust = makeMeasuredAdjust(inputs.measured);
  return ks.map((k, n) => {
    const coords = p.coords(k);
    const mid = mids[n];
    const baseline = interp(mid[1], mid[0]);
    const v = computeRoadAQIv2(rows[k], coords, mid[1], mid[0], baseline, inputs.diurnal, inputs.region,
      inputs.hourLocal, inputs.monthLocal, inputs.camsDaily, iso ? iso[n] : multi!.get(rows[k].osm_way_id));
    const a = adjust ? adjust(mid[1], mid[0], v) : v;
    if (!Number.isFinite(a.pm25)) throw new Error(`non-finite pm25 for road ${k}`);
    return {
      k, aqi: adjust ? pm25ToAQI(a.pm25) : v.aqi, pm25: a.pm25, pm25_delta: v.pm25_delta, no2: v.no2, no2_delta: v.no2_delta,
      confidence: a.confidence, ood: v.ood_refused, pi_half: Math.max(0, a.pi95_hi - a.pm25),
      pi95_lo: a.pi95_lo, pi95_hi: a.pi95_hi,
    };
  });
}
