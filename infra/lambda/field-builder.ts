/**
 * Hourly field builder on AWS Lambda (stack breeva-builder, infra/aws/breeva-builder.yaml). For each region of
 * scripts/field/regions.ts: skip when this hour's run already exists (runs are never overwritten), read the road pack
 * from S3 (cached in /tmp between invocations), build with scripts/field/builder.ts, write the run's cells, inputs and
 * report, then the manifest last. OPENAQ_API_KEY comes from SSM Parameter Store (SecureString) and is never logged.
 * A failure in one region does not stop the others; the function fails if every region failed. After a kriged run the
 * hidden-sensor statistics of the hour join v/<name>/validation_recent.json (task F5-09; statistics only, no readings).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import params from '../../scripts/field/params/measure.json' with { type: 'json' };
import { RoadPack } from '../../scripts/field/pack';
import { buildFieldRun, reportKey, runFor, runObjects, uploadBody } from '../../scripts/field/builder';
import { BUILD_REGIONS, packKey } from '../../scripts/field/regions';
import type { RegionMeasureParams } from '../../scripts/field/measure';
import { dailyEpa, localDate, mergeDaily, mergeRecent, type HourRows, type RecentEntry, type RecentFile } from '../../src/lib/field/validationRecent';
import { withRetry } from '../../src/lib/field/fetchRetry';

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

async function pack(bucket: string, k: string): Promise<RoadPack> {
  const local = `/tmp/${k.replace(/\//g, '_')}`;
  if (!existsSync(local)) {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
    writeFileSync(local, await r.Body!.transformToByteArray());
  }
  return new RoadPack(new Uint8Array(readFileSync(local)));
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
          const reps = await Promise.all(ids.map((id) => readJson<{ validation_rows?: HourRows | null }>(bucket, reportKey(r.name, id))));
          const hours = reps.map((x) => x?.validation_rows).filter((x): x is HourRows => !!x);
          const d = dailyEpa(hours, day, r.tz);
          if (d) next = mergeDaily(next, d);
        }
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(next), CacheControl: 'public, max-age=60, stale-while-revalidate=600', ContentType: 'application/json' }));
      }
      const val = rep.validation && { n: rep.validation.n, rmse: rep.validation.rmse, nrmse: rep.validation.nrmse };
      out.push({ name: r.name, run, roads: rep.roads, pm25_median: rep.pm25.median, measurement: rep.measurement.method, note: rep.measurement.note, validation: val, seconds: rep.seconds.total });
    } catch (e) {
      failed++;
      out.push({ name: r.name, run, error: (e as Error).message });
      // one line per failed region for the breeva-field-region-failed alarm (F2-20): a region can fail while the run
      // as a whole succeeds, which the Lambda Errors metric does not see (run 2026111717, Badung-Denpasar)
      console.log(JSON.stringify({ region_failed: r.name, run, error: (e as Error).message }));
    }
  }
  console.log(JSON.stringify(out));
  if (failed === BUILD_REGIONS.length) throw new Error(`all regions failed: ${JSON.stringify(out)}`);
  return out;
};
