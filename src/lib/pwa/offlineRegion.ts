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

/** bytes: stored on the phone (decoded); sent: downloaded, as the data plan counts it (X-W12; absent in older records). */
export interface SaveResult { files: number; bytes: number; run: string; sent?: number }
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
  let bytes = 0, sent = 0, done = 0;
  for (const file of files) {
    const res = await f(file.url);
    if (!res.ok) throw new Error(`${file.url.split('/').slice(-2).join('/')}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    bytes += buf.byteLength;
    sent += wireSize(res, buf.byteLength);
    const type = res.headers.get('Content-Type') ?? 'application/octet-stream';
    for (const name of file.into) {
      const cache = await cs.open(name);
      await cache.put(file.whole ? fullKey(file.url) : file.url, new Response(buf.slice(0), { headers: { 'Content-Type': type } }));
    }
    opts.onProgress?.(++done, files.length);
  }
  const result = { files: files.length, bytes, run: m.run, sent };
  // the record is written last, so a save cut short is never reported as saved
  const at = new Date().toISOString();
  await (await cs.open(FIELD_CACHES.geometry)).put(markerKey(base, r.name), new Response(JSON.stringify({ ...result, at }), { headers: { 'Content-Type': 'application/json' } }));
  return result;
}

/**
 * Size a response took on the wire: its Content-Length (the encoded size when the file is stored brotli or gzip), or the
 * decoded size when the header is missing (a response compressed on the fly, or rebuilt by the service worker).
 */
export function wireSize(res: Pick<Response, 'headers'>, decoded: number): number {
  const len = Number(res.headers.get('content-length'));
  return Number.isFinite(len) && len > 0 ? len : decoded;
}

/**
 * Download estimate before saving (X-W12): HEAD of every file of the region and the run now published, summing the
 * Content-Length; files that do not tell their size are left out (the manifest, the school points: a few KB).
 */
export async function estimateDownload(base: string, r: RegionRef, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<{ sent: number; files: number; known: number }> {
  const mr = await fetchImpl(`${base}/v/${r.name}/manifest.json`, { cache: 'no-cache' });
  if (!mr.ok) throw new Error(`manifest ${r.name}: HTTP ${mr.status}`);
  const files = regionFiles(base, r, (await mr.json()) as ManifestLike);
  const sizes = await Promise.all(files.map(async (file) => {
    try { const h = await fetchImpl(file.url, { method: 'HEAD' }); const n = Number(h.headers.get('content-length')); return h.ok && n > 0 ? n : 0; } catch { return 0; }
  }));
  return { sent: sizes.reduce((a, b) => a + b, 0), files: files.length, known: sizes.filter((n) => n > 0).length };
}

/** "Tersimpan untuk tanpa internet: 6,9 MB di ponsel, terunduh 2,4 MB (20 berkas, run …" (X-W12). */
export function savedText(sv: SaveResult, when: string): string {
  const sent = sv.sent && sv.sent > 0 ? `, terunduh ${sizeLabel(sv.sent)}` : '';
  return `Tersimpan untuk tanpa internet: ${sizeLabel(sv.bytes)} di ponsel${sent} (${sv.files} berkas, run ${sv.run}, disimpan ${when}).`;
}

/** "Perkiraan unduhan sekitar 2,4 MB" before saving, or '' when nothing could be measured. */
export function estimateText(e: { sent: number; known: number } | null | undefined): string {
  return e && e.sent > 0 && e.known > 0 ? `Perkiraan unduhan sekitar ${sizeLabel(e.sent)}; di ponsel tersimpan lebih besar karena berkas dikirim dimampatkan.` : '';
}

/** "4,1 MB" */
export function sizeLabel(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
}
