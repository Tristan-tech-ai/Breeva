import type { AirQualityData, Coordinate } from '../../types';
import { pm25ToAqi } from '../roadColors';
import type { FieldManifest } from './source';

/** Source code for readings taken from the static field (median of the roads in the map's z12 cell). */
export const FIELD_LAYER_SOURCE = 5;

/** z12 tile holding a point. */
export function tileOf(c: Coordinate, z = 12): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((c.lng + 180) / 360) * n);
  const lr = (c.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(lr)) / Math.PI) / 2) * n);
  return [x, y];
}

/**
 * Reading for the area around `center` from the field manifest: the median of the roads in the z12 cell that holds
 * it. Null when the manifest has no statistics for that cell (outside the region, or an older manifest).
 */
export function areaReadingFromManifest(m: FieldManifest, center: Coordinate): AirQualityData | null {
  if (!m.cell_tiles || !m.cell_stats) return null;
  const [x, y] = tileOf(center);
  const c = m.cell_tiles.findIndex(([tx, ty]) => tx === x && ty === y);
  const st = c >= 0 ? m.cell_stats[String(c)] : undefined;
  if (!st || !Number.isFinite(st.pm25_median)) return null;
  const aqi = pm25ToAqi(st.pm25_median);
  return {
    aqi, level: aqi <= 50 ? 'good' : aqi <= 100 ? 'moderate' : aqi <= 150 ? 'unhealthy-sensitive' : aqi <= 200 ? 'unhealthy' : aqi <= 300 ? 'very-unhealthy' : 'hazardous',
    pm25: st.pm25_median, no2: st.no2_median, pm10: Number.NaN, o3: Number.NaN, co: Number.NaN, so2: null,
    timestamp: m.computed_at, location: center, layer_source: FIELD_LAYER_SOURCE,
    // the area's own clock (the run's UTC hour vs its local hour), so an old reading names the hour the map shows
    utc_offset_h: (m.valid_hour_local - Number(m.run.slice(8, 10)) + 24) % 24,
  };
}
