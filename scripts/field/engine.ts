/**
 * The per-road computation used by the field builder and the parity check. It calls the service engine functions
 * (computeRoadAQIv2, buildMultiSourceDeltas from api/vayu/road-aqi.ts) and never re-implements them.
 */
import { buildMultiSourceDeltas, computeRoadAQIv2, pm25ToAQI, type RoadRow } from '../../api/vayu/road-aqi.js';
import { buildInterpolator, type BaselineCorners, type BaselineData } from '../../api/vayu/_baseline.js';
import type { RoadPack } from './pack.js';
import type { CellValue } from './cells.js';
import { OrdinaryKriging } from './kriging.js';
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
    return (lat: number, lon: number, v: { pm25: number; pm25_delta: number; pi95_hi: number; ood_refused: boolean; confidence: CellValue['confidence'] }) => {
      const r = ok.predict(vals, lat, lon);
      const sd = Math.sqrt(r.variance) * k;
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
  const multi = buildMultiSourceDeltas(rows, interp, inputs.diurnal, inputs.hourLocal, inputs.monthLocal);
  const ks = only ?? rows.map((_, k) => k);
  const adjust = makeMeasuredAdjust(inputs.measured);
  return ks.map((k) => {
    const coords = p.coords(k);
    const mid = coords[Math.floor(coords.length / 2)];
    const baseline = interp(mid[1], mid[0]);
    const v = computeRoadAQIv2(rows[k], coords, mid[1], mid[0], baseline, inputs.diurnal, inputs.region,
      inputs.hourLocal, inputs.monthLocal, inputs.camsDaily, multi.get(rows[k].osm_way_id));
    const a = adjust ? adjust(mid[1], mid[0], v) : v;
    if (!Number.isFinite(a.pm25)) throw new Error(`non-finite pm25 for road ${k}`);
    return {
      k, aqi: adjust ? pm25ToAQI(a.pm25) : v.aqi, pm25: a.pm25, pm25_delta: v.pm25_delta, no2: v.no2, no2_delta: v.no2_delta,
      confidence: a.confidence, ood: v.ood_refused, pi_half: Math.max(0, a.pi95_hi - a.pm25),
      pi95_lo: a.pi95_lo, pi95_hi: a.pi95_hi,
    };
  });
}
