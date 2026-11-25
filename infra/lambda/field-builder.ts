/**
 * Hourly field builder on AWS Lambda (stack breeva-builder, infra/aws/breeva-builder.yaml). For each region of
 * scripts/field/regions.ts: skip when this hour's run already exists (runs are never overwritten), read the road pack
 * from S3 (cached in /tmp between invocations), build with scripts/field/builder.ts, write the run's cells, inputs and
 * report, then the manifest last. OPENAQ_API_KEY comes from SSM Parameter Store (SecureString) and is never logged.
 * A failure in one region does not stop the others; the function fails if every region failed. After a kriged run the
 * hidden-sensor statistics of the hour join v/<name>/validation_recent.json (task F5-09; statistics only, no readings).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import params from '../../scripts/field/params/measure.json' with { type: 'json' };
import { RoadPack } from '../../scripts/field/pack';
import { buildFieldRun, reportKey, runFor, runObjects, uploadBody } from '../../scripts/field/builder';
import { BUILD_REGIONS, packKey } from '../../scripts/field/regions';
import type { RegionMeasureParams } from '../../scripts/field/measure';
import { dailyEpa, dayHours, localDate, mergeDaily, mergeRecent, type HourRows, type RecentEntry, type RecentFile } from '../../src/lib/field/validationRecent';
import { withRetry } from '../../src/lib/field/fetchRetry';
import { mergeRuns, shortReason, type RunRecord, type RunsFile } from '../../src/lib/field/runsRecent';
import { FIRMS_SOURCES, fireFile, firmsUrl, parseFirmsCsv, type FirePoint } from '../../src/lib/nasional/firms';
import { CHUNK, gridPoints, windFile, windUrl } from '../../src/lib/nasional/angin';
import { indexWilayah, tandaiWilayah, type WilayahFC, type WilayahIndex } from '../../src/lib/nasional/wilayah';
import { camsFromBox, camsSeries, camsUrl, INDONESIA_BOX, LATAR_CHUNK, LATAR_HOURS, latarFile, sensorsNow } from '../../src/lib/nasional/latar';
import { readBox } from './openmeteoS3';
import { SC_URL, scFile } from '../../src/lib/nasional/sensorCommunity';
import { asapFile } from '../../src/lib/nasional/asap';
import { FINE_GRID, GRID as WIND_GRID, windFromBoxes, type WindFile } from '../../src/lib/nasional/angin';

// every source fetch (Open-Meteo, OpenAQ, METAR) goes through a retry with a fresh pause budget per invocation (F2-18)
const baseFetch = globalThis.fetch.bind(globalThis);

const s3 = new S3Client({});
const ssm = new SSMClient({});
let openaqKey: string | undefined;

async function key(): Promise<string | undefined> {
  if (openaqKey !== undefined) return openaqKey;
  const name = process.env.OPENAQ_PARAM;
  if (!name) return undefined;
  const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  openaqKey = r.Parameter?.Value ?? '';
  return openaqKey;
}

async function exists(bucket: string, k: string): Promise<boolean> {
  try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: k })); return true; } catch { return false; }
}

async function readJson<T>(bucket: string, k: string): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
    return JSON.parse(await r.Body!.transformToString()) as T;
  } catch { return null; }
}

/** F2-23: one line per region and run in v/<name>/runs_recent.json, so /status shows hours that failed. Never throws. */
async function noteRun(bucket: string, name: string, rec: RunRecord): Promise<void> {
  try {
    const key = `v/${name}/runs_recent.json`;
    const next = mergeRuns(await readJson<RunsFile>(bucket, key), name, rec, new Date());
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(next), CacheControl: 'public, max-age=60, stale-while-revalidate=600', ContentType: 'application/json' }));
  } catch (e) {
    console.log(JSON.stringify({ runs_recent_failed: name, error: shortReason((e as Error).message) }));
  }
}

async function pack(bucket: string, k: string): Promise<RoadPack> {
  const local = `/tmp/${k.replace(/\//g, '_')}`;
  if (!existsSync(local)) {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
    writeFileSync(local, await r.Body!.transformToByteArray());
  }
  return new RoadPack(new Uint8Array(readFileSync(local)));
}


// N-09/N-10: national layers written after the regions; a failure here never blocks the regional fields
let firmsKeyCache: string | undefined;
async function firmsKey(): Promise<string | undefined> {
  if (firmsKeyCache !== undefined) return firmsKeyCache;
  const name = process.env.FIRMS_PARAM;
  if (!name) return undefined;
  const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  firmsKeyCache = r.Parameter?.Value ?? '';
  return firmsKeyCache;
}

// N-23: kab/kota boundaries (v/nasional/kabkota.geojson, gzip) kept for the life of the container
let wilayahCache: WilayahIndex | null = null;
async function wilayah(bucket: string): Promise<WilayahIndex> {
  if (wilayahCache) return wilayahCache;
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'v/nasional/kabkota.geojson' }));
  const b = Buffer.from(await r.Body!.transformToByteArray());
  const txt = (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8');
  wilayahCache = indexWilayah(JSON.parse(txt) as WilayahFC);
  return wilayahCache;
}

async function putNational(bucket: string, key: string, obj: unknown) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: gzipSync(JSON.stringify(obj), { level: 9 }), ContentEncoding: 'gzip',
    CacheControl: 'public, max-age=300, stale-while-revalidate=900', ContentType: 'application/json' }));
}

/** A gzip-stored JSON object of the bucket (the national files), or null. */
async function readGzJson<T>(bucket: string, k: string): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
    const b = Buffer.from(await r.Body!.transformToByteArray());
    return JSON.parse((b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8')) as T;
  } catch { return null; }
}

export async function nasional(bucket: string, now = new Date()): Promise<Record<string, unknown>> {
  const res: Record<string, unknown> = {};
  let firePts: FirePoint[] | null = null;
  let windNow: WindFile | null = null;
  const k = await firmsKey();
  if (k) {
    const by: Record<string, FirePoint[]> = {};
    for (const src of FIRMS_SOURCES) {
      try {
        const r = await fetch(firmsUrl(k, src));
        by[src] = r.ok ? parseFirmsCsv(await r.text(), now) : [];
      } catch (e) {
        by[src] = [];
        res[`galat_${src}`] = String((e as Error).message).split(k).join('***').slice(0, 120);
      }
    }
    const f = fireFile(by, now);
    try {
      const t = tandaiWilayah(f.points, await wilayah(bucket));
      f.points = t.points; f.n = t.points.length; f.luar_indonesia = t.luar; f.luar_points = t.luar_points; f.per_provinsi = t.per_provinsi;
    } catch (e) {
      res.wilayah_gagal = String((e as Error).message).slice(0, 120); // keep the box points rather than publish nothing
    }
    await putNational(bucket, 'v/nasional/titik_api.json', f);
    // N-37: smoke from fires just across the border can drift into Indonesia, so the paths use both lists
    firePts = [...f.points, ...(f.luar_points ?? [])];
    res.titik_api = f.n;
    res.luar_indonesia = f.luar_indonesia ?? null;
  }
  const hourStart = Math.floor(now.getTime() / 3_600_000) * 3600;
  const runIso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16) + 'Z';
  // N-36: wind every hour from ECMWF IFS (0.25 degree) in Open-Meteo's open data on AWS (no call quota); the 1.5 degree file is
  // what the map draws, the 0.25 degree one only feeds the smoke paths (GFS 0.13 took 137 s to read, ECMWF 12 s). The API stays as a fallback every 6 hours.
  let windFine: WindFile | null = null;
  try {
    const t = Date.now();
    // ECMWF IFS 0.25 degree, 3-hourly: 9 steps from the 3-hour step at or before now cover the next 24 hours
    const step3 = Math.floor(hourStart / 10800) * 10800;
    const [u, v] = await Promise.all([
      readBox('ecmwf_ifs025', 'wind_u_component_10m', INDONESIA_BOX, step3, 9),
      readBox('ecmwf_ifs025', 'wind_v_component_10m', INDONESIA_BOX, step3, 9),
    ]);
    const run = runIso(u.meta.last_run_initialisation_time);
    const w = windFromBoxes(u, v, WIND_GRID, now, run);
    windFine = windFromBoxes(u, v, FINE_GRID, now, run);
    await putNational(bucket, 'v/nasional/angin.json', w);
    windNow = w;
    res.angin = { sumber: 's3 ecmwf_ifs025', run, jam: w.hours.length, detik: Math.round((Date.now() - t) / 100) / 10, panggilan_api: 0 };
  } catch (e) {
    res.angin_s3_gagal = String((e as Error).message).slice(0, 120);
  }
  if (!windNow && (now.getUTCHours() % 6 === 0 || !(await exists(bucket, 'v/nasional/angin.json')))) {
    const pts = gridPoints();
    const answers = [];
    for (let i = 0; i < pts.length; i += CHUNK) {
      const r = await fetch(windUrl(pts.slice(i, i + CHUNK)));
      if (!r.ok) throw new Error(`angin ${r.status}`);
      answers.push(await r.json());
    }
    const w = windFile(answers, now);
    await putNational(bucket, 'v/nasional/angin.json', w);
    windNow = w;
    res.angin = { sumber: 'api cadangan', titik: w.speed.length, jam: w.hours.length, panggilan_api: pts.length };
  }
  // N-26: 24-hour smoke paths of the fire clusters, every hour with the newest fires and the stored wind
  if (firePts) {
    try {
      windNow ??= await readGzJson<WindFile>(bucket, 'v/nasional/angin.json');
      const wPath = windFine ?? windNow;
      if (wPath?.hours.length) {
        let h0 = 0;
        wPath.hours.forEach((hh, i) => { if (Math.abs(Date.parse(hh) - now.getTime()) < Math.abs(Date.parse(wPath.hours[h0]) - now.getTime())) h0 = i; });
        const a = asapFile(firePts, wPath, h0, await wilayah(bucket), now);
        await putNational(bucket, 'v/nasional/asap.json', a);
        res.asap = { gugus: a.gugus.length, kabkota_menuju: Object.keys(a.menuju).length, angin: windFine ? '0,25 derajat' : '1,5 derajat' };
      }
    } catch (e) {
      res.asap_gagal = String((e as Error).message).slice(0, 120);
    }
  }
  // N-27: open Sensor.Community sensors in Indonesia, every hour (shown, never used by the model)
  try {
    const r = await fetch(SC_URL);
    if (!r.ok) throw new Error(`sensor.community ${r.status}`);
    const f = scFile((await r.json()) as Parameters<typeof scFile>[0], now);
    await putNational(bucket, 'v/nasional/sensor_community.json', f);
    res.sensor_community = f.sensors.length;
  } catch (e) {
    res.sensor_community_gagal = String((e as Error).message).slice(0, 120);
  }
  // N-22/N-36: background PM2.5 per kab/kota for 48 hours, every hour: CAMS from Open-Meteo's open data on AWS (the API
  // only as a fallback every 6 hours), corrected with the OpenAQ sensors of this hour; its own failure stays here
  {
    try {
      const idx = await wilayah(bucket);
      const centres = idx.items.map((it) => ({ slug: it.p.slug, lon: it.p.pusat[0], lat: it.p.pusat[1] }));
      let cams: { hours: string[]; series: (number | null)[][] } | null = null;
      let camsRun: string | undefined;
      const t = Date.now();
      try {
        const box = await readBox('cams_global', 'pm2_5', INDONESIA_BOX, hourStart, LATAR_HOURS);
        cams = camsFromBox(box, centres);
        camsRun = runIso(box.meta.last_run_initialisation_time);
        res.cams = { sumber: 's3 cams_global', run: camsRun, detik: Math.round((Date.now() - t) / 100) / 10, panggilan_api: 0 };
      } catch (e) {
        res.cams_s3_gagal = String((e as Error).message).slice(0, 120);
      }
      if (!cams && (now.getUTCHours() % 6 === 0 || !(await exists(bucket, 'v/nasional/latar.json')))) {
        const answers = [];
        for (let i = 0; i < centres.length; i += LATAR_CHUNK) {
          const r = await fetch(camsUrl(centres.slice(i, i + LATAR_CHUNK)));
          if (!r.ok) throw new Error(`latar cams ${r.status}`);
          answers.push(await r.json());
        }
        cams = camsSeries(answers);
        res.cams = { sumber: 'api cadangan', panggilan_api: centres.length };
      }
      if (!cams) throw new Error('no CAMS this hour');
      const pages = [];
      const k2 = await key();
      for (let pg = 1; k2 && pg <= 30; pg++) {
        const r = await fetch(`https://api.openaq.org/v3/parameters/2/latest?limit=1000&page=${pg}`, { headers: { 'X-API-Key': k2 } });
        if (!r.ok) break;
        const j = (await r.json()) as { results?: unknown[] };
        pages.push(j as Parameters<typeof sensorsNow>[0][number]);
        if ((j.results?.length ?? 0) < 1000) break;
      }
      const sensors = sensorsNow(pages, now);
      const f = latarFile(centres, cams, sensors, now);
      if (camsRun) f.cams_run = camsRun;
      await putNational(bucket, 'v/nasional/latar.json', f);
      res.latar = { wilayah: centres.length, ...f.jumlah, sensor_indonesia: sensors.length, halaman_openaq: pages.length };
    } catch (e) {
      res.latar_gagal = String((e as Error).message).slice(0, 120);
    }
  }
  return res;
}

export const handler = async () => {
  globalThis.fetch = withRetry(baseFetch, { onRetry: (i) => console.log(JSON.stringify({ retry: i })) }) as typeof fetch;
  const bucket = process.env.FIELD_BUCKET;
  if (!bucket) throw new Error('FIELD_BUCKET not set');
  const out: Array<Record<string, unknown>> = [];
  let failed = 0;
  for (const r of BUILD_REGIONS) {
    const { run } = runFor(new Date());
    try {
      if (await exists(bucket, reportKey(r.name, run))) { out.push({ name: r.name, run, skipped: 'run exists' }); continue; }
      const built = await buildFieldRun(await pack(bucket, packKey(r)), {
        name: r.name, region: r.region, tz: r.tz, indicative: r.indicative, measure: 'auto',
        measureParams: (params.regions as Record<string, RegionMeasureParams>)[r.name], openaqKey: await key(),
      });
      for (const o of runObjects(r.name, built)) {
        const up = uploadBody(o, (b) => gzipSync(b, { level: 9 }));
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: o.key, Body: up.body, ContentEncoding: up.contentEncoding, CacheControl: o.cacheControl, ContentType: o.contentType, Tagging: o.tagging }));
      }
      const rep = built.report as { roads: number; pm25: { median: number }; measurement: { method: string; note?: string }; validation: (Omit<RecentEntry, 'run'> & { scope: string }) | null; seconds: { total: number } };
      if (rep.validation) {
        const key = `v/${r.name}/validation_recent.json`;
        const { n, rmse, nrmse, bias, r2, pi95_coverage, sensor_hour_utc } = rep.validation;
        let next = mergeRecent(await readJson<RecentFile>(bucket, key), r.name, { run, sensor_hour_utc, n, rmse, nrmse, bias, r2, pi95_coverage }, new Date());
        // F5-10: once a local day is over (the day before this run's sensor hour), its daily EPA test from the audit
        // reports of the runs that can hold its hours (from local 00 to 03 of the next day, OpenAQ lags 1-2 h)
        const day = localDate(Date.parse(sensor_hour_utc ?? new Date().toISOString()) - 24 * 3_600_000, r.tz);
        // a day written before F5-24 has no sums to pool: worked out again once
        if (sensor_hour_utc && !(next.daily ?? []).some((d) => d.date === day && d.sums)) {
          const dayStartUtc = Date.parse(`${day}T00:00:00Z`) - r.tz * 3_600_000;
          const ids = Array.from({ length: 28 }, (_, h) => new Date(dayStartUtc + h * 3_600_000).toISOString().slice(0, 13).replace(/[-T]/g, ''));
          const reps = await Promise.all(ids.map((id) => readJson<{ validation_rows?: HourRows | null; validation_rows_earlier?: HourRows[] }>(bucket, reportKey(r.name, id))));
          const hours = dayHours(reps);
          const d = dailyEpa(hours, day, r.tz);
          if (d) next = mergeDaily(next, d);
        }
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(next), CacheControl: 'public, max-age=60, stale-while-revalidate=600', ContentType: 'application/json' }));
      }
      const val = rep.validation && { n: rep.validation.n, rmse: rep.validation.rmse, nrmse: rep.validation.nrmse };
      out.push({ name: r.name, run, roads: rep.roads, pm25_median: rep.pm25.median, measurement: rep.measurement.method, note: rep.measurement.note, validation: val, seconds: rep.seconds.total });
      await noteRun(bucket, r.name, { run, ok: true, seconds: Math.round(rep.seconds.total) });
    } catch (e) {
      failed++;
      out.push({ name: r.name, run, error: (e as Error).message });
      // one line per failed region for the breeva-field-region-failed alarm (F2-20): a region can fail while the run
      // as a whole succeeds, which the Lambda Errors metric does not see (run 2026111717, Badung-Denpasar)
      console.log(JSON.stringify({ region_failed: r.name, run, error: (e as Error).message }));
      await noteRun(bucket, r.name, { run, ok: false, reason: shortReason((e as Error).message) });
    }
  }
  try { out.push({ nasional: await nasional(bucket) }); } catch (e) { console.log(JSON.stringify({ nasional_failed: (e as Error).message.slice(0, 200) })); }
  console.log(JSON.stringify(out));
  if (failed === BUILD_REGIONS.length) throw new Error(`all regions failed: ${JSON.stringify(out)}`);
  return out;
};
