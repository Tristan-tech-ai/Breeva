import type { AirQualityData, Coordinate } from '../../types';
import { areaReadingFromManifest } from './areaReading';
import { defaultFetch, fetchManifest, fieldBase, FIELD_REGIONS } from './source';

const FIELD_STATIC = import.meta.env.VITE_FIELD_STATIC === 'true';

export function regionOf(c: Coordinate) {
  return FIELD_REGIONS.find(({ bounds: [[s, w], [n, e]] }) => c.lat >= s && c.lat <= n && c.lng >= w && c.lng <= e) ?? null;
}

/** Area reading from the static field for a point, or null (flag off, outside every field region, manifest missing). */
export async function readFieldArea(c: Coordinate, fetchImpl: typeof fetch = defaultFetch, enabled = FIELD_STATIC): Promise<AirQualityData | null> {
  if (!enabled) return null;
  const region = regionOf(c);
  if (!region) return null;
  try {
    // the same request the map layer uses (fetchManifest keeps it a minute), so the card and the map share one download
    return areaReadingFromManifest(await fetchManifest(fieldBase(), region.name, fetchImpl), c);
  } catch {
    return null;
  }
}
