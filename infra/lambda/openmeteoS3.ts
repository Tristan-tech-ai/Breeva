/**
 * N-36: read a box of an Open-Meteo model straight from its open data on AWS (s3://openmeteo, HTTPS, no account, no call
 * quota) with @openmeteo/file-reader (WebAssembly; the .wasm file sits next to the bundle). Used by the hourly builder
 * for CAMS PM2.5 (cams_global) and the 10 m wind (ecmwf_ifs025, 3-hourly), so the national layers can refresh every hour.
 */
import { LruBlockCache, OmDataType, OmHttpBackend } from '@openmeteo/file-reader';
import { bboxOf, boxRanges, chunkPlan, joinTime, type OmBox, type OmMeta } from '../../src/lib/nasional/omgrid';

export const OM_BASE = 'https://openmeteo.s3.amazonaws.com/data';

export async function omMeta(model: string): Promise<OmMeta> {
  const r = await fetch(`${OM_BASE}/${model}/static/meta.json`);
  if (!r.ok) throw new Error(`om meta ${model} ${r.status}`);
  return (await r.json()) as OmMeta;
}

/** The box [W, S, E, N] of one variable for `n` time steps from t0 (epoch seconds, rounded down to the model step). */
export async function readBox(model: string, variable: string, box: readonly [number, number, number, number], t0: number, n: number, meta?: OmMeta): Promise<OmBox & { meta: OmMeta }> {
  const m = meta ?? (await omMeta(model));
  const res = m.temporal_resolution_seconds;
  const plan = chunkPlan(m, t0, n);
  const parts: Float32Array[] = [];
  let geo: ReturnType<typeof boxRanges> | null = null;
  for (const p of plan) {
    const backend = new OmHttpBackend({ url: `${OM_BASE}/${model}/${variable}/chunk_${p.chunk}.om` });
    const reader = await backend.asCachedReader(new LruBlockCache());
    const [ny, nx] = reader.getDimensions();
    geo ??= boxRanges(ny, nx, box, bboxOf(m));
    const arr = await reader.read({ type: OmDataType.FloatArray, ranges: [{ start: geo.r0, end: geo.r1 }, { start: geo.c0, end: geo.c1 }, { start: p.start, end: p.end }] });
    parts.push(arr as Float32Array);
  }
  if (!geo) throw new Error(`om ${model}/${variable}: nothing to read`);
  const ny = geo.r1 - geo.r0, nx = geo.c1 - geo.c0;
  const nts = plan.map((p) => p.end - p.start);
  const s0 = Math.floor(t0 / res);
  return {
    lat0: geo.lat0, lon0: geo.lon0, dlat: geo.dlat, dlon: geo.dlon, ny, nx,
    times: Array.from({ length: nts.reduce((a, b) => a + b, 0) }, (_, k) => (s0 + k) * res),
    data: joinTime(parts, ny, nx, nts), meta: m,
  };
}
