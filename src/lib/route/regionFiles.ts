/**
 * The files the on-device router needs for one region, requested together (F1-53). The worker used to wait for each
 * file before asking for the next (graph, manifest, cells, harga, schools): on a slow 3G link every wait costs about
 * 2 s of latency before any byte arrives. Only the cells wait, because their names come from the manifest.
 */
import type { ForecastEntry } from '../field/forecast';

export type GetBytes = (url: string, opts: { cacheFirst: boolean }) => Promise<Uint8Array>;

export interface RegionManifest { run: string; cells: number[]; valid_hour_local?: number; forecast_runs?: ForecastEntry[] }

export interface RegionFiles {
  graph: Uint8Array;
  manifest: RegionManifest;
  cells: Map<number, Uint8Array>;
  /** null when the region has no harga hirup file or it failed */
  harga: Uint8Array | null;
  /** null when the region has no school points or they failed */
  schools: Uint8Array | null;
}

export async function loadRegionFiles(base: string, region: { name: string; geometry: string }, get: GetBytes): Promise<RegionFiles> {
  const graphP = get(`${base}/graphs/${region.geometry}/${region.name}.bin`, { cacheFirst: true });
  const hargaP = get(`${base}/harga/${region.geometry}/${region.name}.bin`, { cacheFirst: true }).catch(() => null);
  const schoolsP = get(`${base}/graphs/${region.geometry}/${region.name}_schools.json`, { cacheFirst: false }).catch(() => null);
  graphP.catch(() => undefined); // awaited below; this only keeps an early manifest failure from leaving it unhandled
  const manifest = JSON.parse(new TextDecoder().decode(await get(`${base}/v/${region.name}/manifest.json`, { cacheFirst: false }))) as RegionManifest;
  const cellsP = Promise.all(manifest.cells.map(async (c) =>
    [c, await get(`${base}/v/${region.name}/${manifest.run}/${c}.bin`, { cacheFirst: true })] as const));
  const [graph, cells, harga, schools] = await Promise.all([graphP, cellsP, hargaP, schoolsP]);
  return { graph, manifest, cells: new Map(cells), harga, schools };
}
