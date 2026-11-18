/**
 * The files the on-device router needs for one region, requested together (F1-53). The worker used to wait for each
 * file before asking for the next (graph, manifest, cells, harga, schools): on a slow 3G link every wait costs about
 * 2 s of latency before any byte arrives. Only the cells wait, because their names come from the manifest.
 */
import type { ForecastEntry } from '../field/forecast';
import { decodeCore } from './coreCodec';

export type GetBytes = (url: string, opts: { cacheFirst: boolean }) => Promise<Uint8Array>;

export interface RegionManifest { run: string; cells: number[]; valid_hour_local?: number; forecast_runs?: ForecastEntry[] }

export interface RegionFiles {
  /** core walking graph (F1-56: without the edge shapes, graphSplit.ts) */
  graph: Uint8Array;
  /** where the edge shapes are; fetched after the rest, so they do not slow the first route */
  shapesUrl: string;
  manifest: RegionManifest;
  cells: Map<number, Uint8Array>;
  /** null when the region has no harga hirup file or it failed */
  harga: Uint8Array | null;
  /** null when the region has no school points or they failed */
  schools: Uint8Array | null;
}

export async function loadRegionFiles(base: string, region: { name: string; geometry: string }, get: GetBytes,
  /** called as soon as the manifest is read, before the graph and cells arrive (F1-64) */
  onManifest?: (m: RegionManifest) => void): Promise<RegionFiles> {
  const graphP = get(graphUrls(base, region).core, { cacheFirst: true }).then(decodeCore);
  const hargaP = get(`${base}/harga/${region.geometry}/${region.name}.bin`, { cacheFirst: true }).catch(() => null);
  const schoolsP = get(`${base}/graphs/${region.geometry}/${region.name}_schools.json`, { cacheFirst: false }).catch(() => null);
  graphP.catch(() => undefined); // awaited below; this only keeps an early manifest failure from leaving it unhandled
  const manifest = JSON.parse(new TextDecoder().decode(await get(`${base}/v/${region.name}/manifest.json`, { cacheFirst: false }))) as RegionManifest;
  onManifest?.(manifest);
  const cellsP = Promise.all(manifest.cells.map(async (c) =>
    [c, await get(`${base}/v/${region.name}/${manifest.run}/${c}.bin`, { cacheFirst: true })] as const));
  const [graph, cells, harga, schools] = await Promise.all([graphP, cellsP, hargaP, schoolsP]);
  return { graph, shapesUrl: graphUrls(base, region).shapes, manifest, cells: new Map(cells), harga, schools };
}

/**
 * The two files of a region's walking graph (F1-56), in their smaller forms: the core BGC1 (F1-61, coreCodec.ts) and the
 * shapes BSC1 (F1-62, shapeCodec.ts). _inti.bin, _bentuk.bin and the single BGR1 file stay for older app versions.
 */
export function graphUrls(base: string, region: { name: string; geometry: string }) {
  const dir = `${base}/graphs/${region.geometry}/${region.name}`;
  return { core: `${dir}_inti2.bin`, shapes: `${dir}_bentuk2.bin` };
}
