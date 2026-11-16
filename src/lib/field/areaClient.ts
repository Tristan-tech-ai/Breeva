import type { AirQualityData, Coordinate } from '../../types';
import { areaReadingFromManifest } from './areaReading';
import { fieldBase, FIELD_REGIONS, type FieldManifest } from './source';

const FIELD_STATIC = import.meta.env.VITE_FIELD_STATIC === 'true';
const cache = new Map<string, { at: number; m: FieldManifest }>();

export function regionOf(c: Coordinate) {
  return FIELD_REGIONS.find(({ bounds: [[s, w], [n, e]] }) => c.lat >= s && c.lat <= n && c.lng >= w && c.lng <= e) ?? null;
}

/** Area reading from the static field for a point, or null (flag off, outside every field region, manifest missing). */
export async function readFieldArea(c: Coordinate, fetchImpl: typeof fetch = (...a) => fetch(...a), enabled = FIELD_STATIC): Promise<AirQualityData | null> {
  if (!enabled) return null;
  const region = regionOf(c);
  if (!region) return null;
  try {
    let hit = cache.get(region.name);
    if (!hit || Date.now() - hit.at > 60_000) {
      const r = await fetchImpl(`${fieldBase()}/v/${region.name}/manifest.json`, { cache: 'no-cache' });
      if (!r.ok) return null;
      hit = { at: Date.now(), m: (await r.json()) as FieldManifest };
      cache.set(region.name, hit);
    }
    return areaReadingFromManifest(hit.m, c);
  } catch {
    return null;
  }
}
