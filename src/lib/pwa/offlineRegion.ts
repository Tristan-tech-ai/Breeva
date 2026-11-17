/**
 * Save one whole region for use without internet (task F2-15, for the offline demo at the final). Pressed by the user,
 * never automatic: it downloads the region's own field files once (PMTiles geometry whole, the value cells, forecasts
 * and harga of the run now published, the walking graph and schools) and puts them in the caches the service worker and
 * the router read. The OpenStreetMap basemap is not saved (its tile policy forbids bulk downloading).
 */
import { FIELD_CACHES, fullKey } from './fieldCache';
import { ROUTE_CACHE } from '../route/assets';

export interface RegionRef { name: string; geometry: string }
interface ManifestLike { run: string; cells: number[]; forecast_runs?: Array<{ key: string }> }
export interface RegionFile { url: string; into: string[]; whole?: boolean }

/** Every file the map and the router read for one region and the run now published, with the caches it goes into. */
export function regionFiles(base: string, r: RegionRef, m: ManifestLike): RegionFile[] {
  const v = `${base}/v/${r.name}`;
  return [
    { url: `${base}/tiles/${r.geometry}/${r.name}.pmtiles`, into: [FIELD_CACHES.geometry], whole: true },
    { url: `${v}/manifest.json`, into: [FIELD_CACHES.manifest, ROUTE_CACHE] },
    ...m.cells.map((c) => ({ url: `${v}/${m.run}/${c}.bin`, into: [FIELD_CACHES.cells, ROUTE_CACHE] })),
    ...(m.forecast_runs ?? []).map((f) => ({ url: `${v}/${m.run}/${f.key}`, into: [ROUTE_CACHE] })),
    { url: `${base}/harga/${r.geometry}/${r.name}.bin`, into: [FIELD_CACHES.harga, ROUTE_CACHE] },
    // the walking graph as the router loads it since F1-56: core and shapes
    { url: `${base}/graphs/${r.geometry}/${r.name}_inti.bin`, into: [ROUTE_CACHE] },
    { url: `${base}/graphs/${r.geometry}/${r.name}_bentuk.bin`, into: [ROUTE_CACHE] },
    { url: `${base}/graphs/${r.geometry}/${r.name}_schools.json`, into: [ROUTE_CACHE] },
  ];
}

export interface SaveResult { files: number; bytes: number; run: string }
export interface SavedInfo extends SaveResult { at: string }
type CachesLike = { open(name: string): Promise<Pick<Cache, 'put' | 'match'>> };

/** Where the record of a saved region is kept (next to its whole archive, never pruned). */
export function markerKey(base: string, name: string): string {
  return `${base}/__simpan/${name}.json`;
}

/**
 * What is saved for a region, read from the caches themselves (task F2-16): the record written after a complete save,
 * and only while the whole archive it describes is still there. Null when nothing (or not everything) is saved.
 */
export async function readSaved(base: string, r: RegionRef, cachesImpl: CachesLike = caches): Promise<SavedInfo | null> {
  try {
    const cache = await cachesImpl.open(FIELD_CACHES.geometry);
    const rec = await cache.match(markerKey(base, r.name));
    if (!rec) return null;
    const archive = await cache.match(fullKey(`${base}/tiles/${r.geometry}/${r.name}.pmtiles`));
    if (!archive) return null;
    const info = (await rec.json()) as SavedInfo;
    return typeof info.run === 'string' && typeof info.bytes === 'number' ? info : null;
  } catch {
    return null;
  }
}

export async function saveRegionOffline(
  base: string, r: RegionRef,
  opts: { fetchImpl?: typeof fetch; cachesImpl?: CachesLike; onProgress?: (done: number, total: number) => void } = {},
): Promise<SaveResult> {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const cs = opts.cachesImpl ?? caches;
  const mr = await f(`${base}/v/${r.name}/manifest.json`, { cache: 'no-cache' });
  if (!mr.ok) throw new Error(`manifest ${r.name}: HTTP ${mr.status}`);
  const m = (await mr.json()) as ManifestLike;
  const files = regionFiles(base, r, m);
  let bytes = 0, done = 0;
  for (const file of files) {
    const res = await f(file.url);
    if (!res.ok) throw new Error(`${file.url.split('/').slice(-2).join('/')}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    bytes += buf.byteLength;
    const type = res.headers.get('Content-Type') ?? 'application/octet-stream';
    for (const name of file.into) {
      const cache = await cs.open(name);
      await cache.put(file.whole ? fullKey(file.url) : file.url, new Response(buf.slice(0), { headers: { 'Content-Type': type } }));
    }
    opts.onProgress?.(++done, files.length);
  }
  const result = { files: files.length, bytes, run: m.run };
  // the record is written last, so a save cut short is never reported as saved
  const at = new Date().toISOString();
  await (await cs.open(FIELD_CACHES.geometry)).put(markerKey(base, r.name), new Response(JSON.stringify({ ...result, at }), { headers: { 'Content-Type': 'application/json' } }));
  return result;
}

/** "4,1 MB" */
export function sizeLabel(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
}
