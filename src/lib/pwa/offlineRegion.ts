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
    { url: `${base}/graphs/${r.geometry}/${r.name}.bin`, into: [ROUTE_CACHE] },
    { url: `${base}/graphs/${r.geometry}/${r.name}_schools.json`, into: [ROUTE_CACHE] },
  ];
}

export interface SaveResult { files: number; bytes: number; run: string }
type CachesLike = { open(name: string): Promise<Pick<Cache, 'put'>> };

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
  return { files: files.length, bytes, run: m.run };
}

/** "4,1 MB" */
export function sizeLabel(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
}
