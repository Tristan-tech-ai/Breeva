/**
 * Hourly field builder on AWS Lambda (stack breeva-builder, infra/aws/breeva-builder.yaml). For each region of
 * scripts/field/regions.ts: skip when this hour's run already exists (runs are never overwritten), read the road pack
 * from S3 (cached in /tmp between invocations), build with scripts/field/builder.ts, write the run's cells, inputs and
 * report, then the manifest last. OPENAQ_API_KEY comes from SSM Parameter Store (SecureString) and is never logged.
 * A failure in one region does not stop the others; the function fails if every region failed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import params from '../../scripts/field/params/measure.json' with { type: 'json' };
import { RoadPack } from '../../scripts/field/pack';
import { buildFieldRun, reportKey, runFor, runObjects } from '../../scripts/field/builder';
import { BUILD_REGIONS, packKey } from '../../scripts/field/regions';
import type { RegionMeasureParams } from '../../scripts/field/measure';

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

async function pack(bucket: string, k: string): Promise<RoadPack> {
  const local = `/tmp/${k.replace(/\//g, '_')}`;
  if (!existsSync(local)) {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
    writeFileSync(local, await r.Body!.transformToByteArray());
  }
  return new RoadPack(new Uint8Array(readFileSync(local)));
}

export const handler = async () => {
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
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: o.key, Body: o.body, CacheControl: o.cacheControl, ContentType: o.contentType, Tagging: o.tagging }));
      }
      const rep = built.report as { roads: number; pm25: { median: number }; measurement: { method: string; note?: string }; seconds: { total: number } };
      out.push({ name: r.name, run, roads: rep.roads, pm25_median: rep.pm25.median, measurement: rep.measurement.method, note: rep.measurement.note, seconds: rep.seconds.total });
    } catch (e) {
      failed++;
      out.push({ name: r.name, run, error: (e as Error).message });
    }
  }
  console.log(JSON.stringify(out));
  if (failed === BUILD_REGIONS.length) throw new Error(`all regions failed: ${JSON.stringify(out)}`);
  return out;
};
