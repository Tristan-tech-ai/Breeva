#!/usr/bin/env node
/**
 * Upload the current field of each region to the breeva-field bucket (infra/aws/breeva-field.yaml), manifest last.
 *
 *   node scripts/field/publish-aws.mjs --bucket breeva-field-<account> [--root D:/breeva-ml-data/field] [--region a,b] [--dry]
 *
 * Uses the AWS CLI already signed in on this machine; credentials are never read or printed here.
 */
import { execFileSync } from 'node:child_process';
import { planUploads } from './publish-plan.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const bucket = arg('bucket');
if (!bucket || !/^breeva-/.test(bucket)) throw new Error('--bucket must be a breeva-* bucket');
const root = arg('root', 'D:/breeva-ml-data/field');
const regions = arg('region', 'badung_denpasar,kota_bogor').split(',');
const plan = planUploads(root, regions);
for (const u of plan) {
  const cmd = ['s3', 'cp', u.local, `s3://${bucket}/${u.key}`, '--cache-control', u.cacheControl, '--content-type', u.contentType, '--only-show-errors'];
  if (process.argv.includes('--dry')) { console.log('aws', cmd.join(' ')); continue; }
  execFileSync('aws', cmd, { stdio: 'inherit' });
  console.log(`uploaded ${u.key}`);
}
console.log(JSON.stringify({ bucket, files: plan.length, regions }));
