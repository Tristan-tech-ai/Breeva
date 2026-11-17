/**
 * Static field client (LAMPIRAN_TEKNIS L1.5): road geometry from PMTiles, values from BVF1 cells, freshness from the
 * manifest. No API or database call: everything is a static file under the field base URL.
 */
import { PMTiles } from 'pmtiles';
import { decodeCell, type CellValue } from './cells';
import { HargaIndex } from './harga';

export interface FieldManifest {
  geometry: string; run: string; computed_at: string; valid_hour_local: number; engine: string; cells: number[];
  sensors_used?: number; inputs_note?: string;
  /** z12 tile [x, y] of each cell index (pack order). */
  cell_tiles?: Array<[number, number]>;
  /** Per cell: median of the roads' PM2.5 and NO2 (µg/m³) and road count. */
  cell_stats?: Record<string, { pm25_median: number; no2_median: number; roads: number }>;
  /** True when no measuring station lies inside the area: values are indicative only. */
  indicative?: boolean;
  /** Measurement layer of the run: kriging (citizen sensors), koschmieder (airport smoke), none or off. */
  measurement?: { method: string; hour_utc?: string | null; sensor_hour_utc?: string | null; metar?: string | null };
}

export interface FieldRegion { name: string; label: string; geometry: string; bounds: [[number, number], [number, number]]; home: { lat: number; lng: number } }

/** Regions with a published field. bounds = [[south, west], [north, east]]. */
export const FIELD_REGIONS: FieldRegion[] = [
  { name: 'badung_denpasar', label: 'Badung–Denpasar', geometry: '2026-11', bounds: [[-8.82, 115.08], [-8.56, 115.3]], home: { lat: -8.6705, lng: 115.2126 } },
  // Kota Bogor: the six kecamatan from OSM; no measuring station inside the city, so the manifest marks it indicative.
  { name: 'kota_bogor', label: 'Kota Bogor', geometry: '2026-11', bounds: [[-6.6813, 106.7348], [-6.5143, 106.8486]], home: { lat: -6.595, lng: 106.797 } },
];

/** Field region named in the URL (?wilayah=), else the first one (Badung-Denpasar). */
export function pickRegion(name: string | null): FieldRegion {
  return FIELD_REGIONS.find((r) => r.name === name) ?? FIELD_REGIONS[0];
}

const LAST_REGION_KEY = 'breeva_field_region';
/** Time zones of WIB: a phone set to one starts in Kota Bogor, the WIB field region. */
const WIB_ZONES = new Set(['Asia/Jakarta', 'Asia/Pontianak']);

/**
 * Region the app map starts in (F1-52): ?wilayah= in the URL, else the region last opened on this device, else Kota Bogor
 * for a phone in WIB, else Badung-Denpasar. Never Jakarta: it has no published field, so its roads have no colour.
 */
export function chooseStartRegion(o: { param?: string | null; stored?: string | null; timeZone?: string | null }): FieldRegion {
  const byName = (n?: string | null) => (n ? FIELD_REGIONS.find((r) => r.name === n) : undefined);
  return byName(o.param) ?? byName(o.stored) ?? (o.timeZone && WIB_ZONES.has(o.timeZone) ? byName('kota_bogor') : undefined) ?? FIELD_REGIONS[0];
}

/** chooseStartRegion with the browser's URL, storage and time zone; each read may fail (private mode, no window). */
export function startRegionHere(): FieldRegion {
  let param: string | null = null, stored: string | null = null, timeZone: string | null = null;
  try { param = new URLSearchParams(globalThis.location?.search ?? '').get('wilayah'); } catch { /* no location */ }
  try { stored = globalThis.localStorage?.getItem(LAST_REGION_KEY) ?? null; } catch { /* storage blocked */ }
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { /* no Intl zone */ }
  return chooseStartRegion({ param, stored, timeZone });
}

/** Remember the region the visitor chose, for the next start. */
export function rememberRegion(name: string): void {
  try { globalThis.localStorage?.setItem(LAST_REGION_KEY, name); } catch { /* storage blocked: start from the default */ }
}

export const STALE_HOURS = 3;

export function fieldBase(): string {
  return (import.meta.env.VITE_FIELD_BASE as string | undefined)?.replace(/\/$/, '') || '/field';
}

/** Event the field layer sends once its first colored roads are drawn (the base map waits for it, F1-13). */
export const FIELD_DRAWN_EVENT = 'breeva:field-drawn';

/** Box [[south, west], [north, east]]. */
export type Box = [[number, number], [number, number]];

/**
 * Cells whose z12 tile (manifest cell_tiles, indexed by cell) intersects the box: fetched together with the geometry
 * instead of after the first tiles are decoded (F1-13).
 */
export function cellsInView(m: Pick<FieldManifest, 'cells' | 'cell_tiles'>, box: Box): number[] {
  if (!m.cell_tiles?.length) return [];
  const n = 2 ** 12;
  const x = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const y = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const [[s, w], [nl, e]] = box;
  const x0 = x(w), x1 = x(e), y0 = y(nl), y1 = y(s);
  return m.cells.filter((c) => {
    const t = m.cell_tiles![c];
    return !!t && t[0] >= x0 && t[0] <= x1 && t[1] >= y0 && t[1] <= y1;
  });
}

/** The browser fetch, one function: the manifest cache below is shared by everything that uses it. */
export const defaultFetch: typeof fetch = (...a) => fetch(...a);

export const MANIFEST_TTL_MS = 60_000;
const manifestCaches = new WeakMap<typeof fetch, Map<string, { at: number; p: Promise<FieldManifest> }>>();

/**
 * Region manifest, shared by the value card (areaClient) and the map layer (FieldSource): one request per region per
 * minute, including requests made while the first is still in flight (F1-51: on a slow 3G link every request costs about
 * 2 s, and the map layer used to fetch the manifest again after the card had). A failed request is not kept.
 */
export function fetchManifest(base: string, name: string, fetchImpl: typeof fetch = defaultFetch, now = Date.now()): Promise<FieldManifest> {
  let cache = manifestCaches.get(fetchImpl);
  if (!cache) { cache = new Map(); manifestCaches.set(fetchImpl, cache); }
  const key = `${base}/v/${name}`;
  const hit = cache.get(key);
  if (hit && now - hit.at <= MANIFEST_TTL_MS) return hit.p;
  const p = fetchImpl(`${key}/manifest.json`, { cache: 'no-cache' }).then(async (r) => {
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return (await r.json()) as FieldManifest;
  });
  cache.set(key, { at: now, p });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });
  return p;
}

export class FieldSource {
  readonly pm: PMTiles;
  manifest: FieldManifest | null = null;
  highwayCodes: string[] = [];
  /** Harga hirup per road (BHI1), null until loaded or when the region has none yet. */
  harga: HargaIndex | null = null;
  private readonly cells = new Map<number, CellValue[]>();
  private readonly pending = new Map<number, Promise<void>>();
  private hargaLoad: Promise<void> | null = null;
  private readonly tilePromises = new Map<string, Promise<{ data: ArrayBuffer } | undefined>>();
  /** Called whenever a cell arrives, so the layer can redraw. */
  onCell: (() => void) | null = null;

  readonly region: FieldRegion;
  readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(region: FieldRegion, base = fieldBase(), fetchImpl: typeof fetch = defaultFetch) {
    this.region = region;
    this.base = base;
    this.fetchImpl = fetchImpl;
    this.pm = new PMTiles(`${base}/tiles/${region.geometry}/${region.name}.pmtiles`);
  }

  /** Resolves once the archive metadata (highway codes) has arrived or failed. */
  metaReady: Promise<void> = Promise.resolve();

  /**
   * Manifest, then the cells in view. The archive header and metadata do not depend on the manifest, so they are asked
   * for at the same time, and init does not wait for the metadata: the highway codes only set line widths, and the layer
   * redraws (onCell) when they arrive (F1-54: on slow 3G each wait in a row costs about 2 s). The harga hirup file is not
   * loaded here: ensureHarga() loads it when the mode needs it or once the map is colored.
   */
  async init(view?: Box): Promise<void> {
    this.metaReady = this.pm.getMetadata().then(
      (meta) => { this.highwayCodes = (meta as { highway_codes?: string[] } | undefined)?.highway_codes ?? []; this.onCell?.(); },
      (e) => { console.warn('[field] metadata', this.region.name, e); },
    );
    const m = await fetchManifest(this.base, this.region.name, this.fetchImpl);
    if (m.geometry !== this.region.geometry) throw new Error(`geometry ${m.geometry} does not match tiles ${this.region.geometry}`);
    this.manifest = m;
    if (view) for (const c of cellsInView(m, view)) void this.loadCell(c);
  }

  /** Loads the harga hirup file once (idempotent). */
  ensureHarga(): Promise<void> {
    this.hargaLoad ??= this.loadHarga();
    return this.hargaLoad;
  }

  /** Loads the harga hirup file of the region; a region without one keeps harga = null. */
  async loadHarga(): Promise<void> {
    try {
      const r = await this.fetchImpl(`${this.base}/harga/${this.region.geometry}/${this.region.name}.bin`);
      if (!r.ok) return;
      this.harga = new HargaIndex(new Uint8Array(await r.arrayBuffer()));
      this.onCell?.();
    } catch {
      this.harga = null; // missing file (a dev server answers with index.html) or a broken one
    }
  }

  /** True once at least one value cell has arrived. */
  hasCells(): boolean {
    return this.cells.size > 0;
  }

  /** Resolves when every cell request made so far has arrived or failed. */
  cellsSettled(): Promise<void> {
    return Promise.allSettled([...this.pending.values()]).then(() => undefined);
  }

  /**
   * Native tile bytes (z <= 14), fetched once per tile and shared by its overzoomed children and by redraws: without
   * this every z15 child and every redraw fetched the same range again (F1-13: 6 copies of one 42 KB range).
   */
  tile(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined> {
    const key = `${z}/${x}/${y}`;
    let p = this.tilePromises.get(key);
    if (!p) {
      p = this.pm.getZxy(z, x, y).catch((e) => { this.tilePromises.delete(key); throw e; });
      this.tilePromises.set(key, p);
      if (this.tilePromises.size > 256) this.tilePromises.delete(this.tilePromises.keys().next().value as string);
    }
    return p;
  }

  /** Value of road (c, i), or undefined while its cell is loading (the load starts here). */
  value(c: number, i: number): CellValue | undefined {
    const cell = this.cells.get(c);
    if (cell) return cell[i];
    void this.loadCell(c);
    return undefined;
  }

  loadCell(c: number): Promise<void> {
    if (!this.manifest || !this.manifest.cells.includes(c)) return Promise.resolve();
    let p = this.pending.get(c);
    if (!p) {
      p = this.fetchImpl(`${this.base}/v/${this.region.name}/${this.manifest.run}/${c}.bin`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`cell ${c}: ${r.status}`))))
        .then((buf) => { this.cells.set(c, decodeCell(new Uint8Array(buf))); this.onCell?.(); })
        .catch((e) => { this.pending.delete(c); console.warn('[field]', e); });
      this.pending.set(c, p);
    }
    return p;
  }

  highway(h: number): string {
    return this.highwayCodes[h] ?? 'other';
  }

  ageHours(now = Date.now()): number {
    return this.manifest ? (now - Date.parse(this.manifest.computed_at)) / 3_600_000 : Infinity;
  }

  isStale(now = Date.now()): boolean {
    return this.ageHours(now) > STALE_HOURS;
  }
}

/** Geometry of a z14 tile reused for an overzoomed child tile (z > 14): scale and shift to the child's frame. */
export function overzoomPoints<P extends { x: number; y: number }>(
  rings: P[][], extent: number, child: { x: number; y: number; z: number }, maxNative = 14,
): Array<Array<{ x: number; y: number }>> {
  const dz = child.z - maxNative;
  if (dz <= 0) return rings;
  const s = 2 ** dz;
  const ox = (child.x - (child.x >> dz) * s) * extent;
  const oy = (child.y - (child.y >> dz) * s) * extent;
  return rings.map((ring) => ring.map((p) => ({ x: p.x * s - ox, y: p.y * s - oy })));
}

export function ageLabel(hours: number): string {
  if (!Number.isFinite(hours)) return 'umur data tidak diketahui';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} menit lalu`;
  if (hours < 48) return `${Math.round(hours)} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
}
