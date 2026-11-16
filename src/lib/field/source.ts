/**
 * Static field client (LAMPIRAN_TEKNIS L1.5): road geometry from PMTiles, values from BVF1 cells, freshness from the
 * manifest. No API or database call: everything is a static file under the field base URL.
 */
import { PMTiles } from 'pmtiles';
import { decodeCell, type CellValue } from './cells';

export interface FieldManifest {
  geometry: string; run: string; computed_at: string; valid_hour_local: number; engine: string; cells: number[];
  sensors_used?: number; inputs_note?: string;
  /** z12 tile [x, y] of each cell index (pack order). */
  cell_tiles?: Array<[number, number]>;
  /** Per cell: median of the roads' PM2.5 and NO2 (µg/m³) and road count. */
  cell_stats?: Record<string, { pm25_median: number; no2_median: number; roads: number }>;
}

export interface FieldRegion { name: string; label: string; geometry: string; bounds: [[number, number], [number, number]]; home: { lat: number; lng: number } }

/** Regions with a published field. bounds = [[south, west], [north, east]]. */
export const FIELD_REGIONS: FieldRegion[] = [
  { name: 'badung_denpasar', label: 'Badung–Denpasar', geometry: '2026-11', bounds: [[-8.82, 115.08], [-8.56, 115.3]], home: { lat: -8.6705, lng: 115.2126 } },
];

export const STALE_HOURS = 3;

export function fieldBase(): string {
  return (import.meta.env.VITE_FIELD_BASE as string | undefined)?.replace(/\/$/, '') || '/field';
}

export class FieldSource {
  readonly pm: PMTiles;
  manifest: FieldManifest | null = null;
  highwayCodes: string[] = [];
  private readonly cells = new Map<number, CellValue[]>();
  private readonly pending = new Map<number, Promise<void>>();
  /** Called whenever a cell arrives, so the layer can redraw. */
  onCell: (() => void) | null = null;

  readonly region: FieldRegion;
  readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(region: FieldRegion, base = fieldBase(), fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.region = region;
    this.base = base;
    this.fetchImpl = fetchImpl;
    this.pm = new PMTiles(`${base}/tiles/${region.geometry}/${region.name}.pmtiles`);
  }

  async init(): Promise<void> {
    const r = await this.fetchImpl(`${this.base}/v/${this.region.name}/manifest.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    const m = (await r.json()) as FieldManifest;
    if (m.geometry !== this.region.geometry) throw new Error(`geometry ${m.geometry} does not match tiles ${this.region.geometry}`);
    this.manifest = m;
    const meta = (await this.pm.getMetadata()) as { highway_codes?: string[] } | undefined;
    this.highwayCodes = meta?.highway_codes ?? [];
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
