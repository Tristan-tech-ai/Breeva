import type { PollutantType, RoadDisplayMode } from '../../types';
import { CONTRAST_FALLBACK, DELTA_STOPS, lerpColor, pm25ToAqi, TOTAL_STOPS } from '../roadColors';
import type { CellValue } from './cells';

/** Value used for coloring. The field has PM2.5 and NO2 (total and traffic part); other pollutants fall back to PM2.5. */
export function fieldColor(v: CellValue, pollutant: PollutantType, mode: RoadDisplayMode, contrastMax: number): string {
  if (v.ood) return '#9ca3af';
  const p = pollutant === 'no2' ? 'no2' : 'pm25';
  if (mode === 'delta') return lerpColor(DELTA_STOPS[p], p === 'no2' ? v.no2_delta : v.pm25_delta);
  if (mode === 'contrast') {
    const d = p === 'no2' ? v.no2_delta : v.pm25_delta;
    const t = Math.max(0, Math.min(1, d / (contrastMax || CONTRAST_FALLBACK[p] || 1)));
    return lerpColor(TOTAL_STOPS.aqi, t * 300);
  }
  if (pollutant === 'aqi') return lerpColor(TOTAL_STOPS.aqi, pm25ToAqi(v.pm25));
  return lerpColor(TOTAL_STOPS[p], p === 'no2' ? v.no2 : v.pm25);
}
