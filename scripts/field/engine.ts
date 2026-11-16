/**
 * The per-road computation used by the field builder and the parity check. It calls the service engine functions
 * (computeRoadAQIv2, buildMultiSourceDeltas from api/vayu/road-aqi.ts) and never re-implements them.
 */
import { buildMultiSourceDeltas, computeRoadAQIv2, type RoadRow } from '../../api/vayu/road-aqi.js';
import { buildInterpolator, type BaselineCorners, type BaselineData } from '../../api/vayu/_baseline.js';
import type { RoadPack } from './pack.js';
import type { CellValue } from './cells.js';

/** Everything the computation depends on, saved with each run so it can be recomputed exactly. */
export interface FieldInputs {
  region: string;            // engine region key, e.g. 'bali'
  hourLocal: number;
  monthLocal: number;
  diurnal: number;
  camsDaily: number;
  /** One background grid per pack cell, as fetched from Open-Meteo. */
  grids: Array<{ cell: number; corners: BaselineCorners; bounds: { south: number; west: number; north: number; east: number } }>;
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
  return ks.map((k) => {
    const coords = p.coords(k);
    const mid = coords[Math.floor(coords.length / 2)];
    const baseline = interp(mid[1], mid[0]);
    const v = computeRoadAQIv2(rows[k], coords, mid[1], mid[0], baseline, inputs.diurnal, inputs.region,
      inputs.hourLocal, inputs.monthLocal, inputs.camsDaily, multi.get(rows[k].osm_way_id));
    if (!Number.isFinite(v.pm25)) throw new Error(`non-finite pm25 for road ${k}`);
    return {
      k, aqi: v.aqi, pm25: v.pm25, pm25_delta: v.pm25_delta, no2: v.no2, no2_delta: v.no2_delta,
      confidence: v.confidence, ood: v.ood_refused, pi_half: Math.max(0, v.pi95_hi - v.pm25),
      pi95_lo: v.pi95_lo, pi95_hi: v.pi95_hi,
    };
  });
}
