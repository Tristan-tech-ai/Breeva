#!/usr/bin/env node
/**
 * Upload the current field of each region to the breeva-field bucket (infra/aws/breeva-field.yaml), manifest last.
 *
 *   node scripts/field/publish-aws.mjs --bucket breeva-field-<account> [--root D:/breeva-ml-data/field] [--region a,b] [--dry] [--with-runs]
 *
 * Since 16 Nov the hourly Lambda (stack breeva-builder) owns v/: runs and manifests are skipped unless --with-runs,
 * so a local manifest never replaces a newer one in the bucket. Tiles, harga hirup, graphs and school points go up.
 * Uses the AWS CLI already signed in on this machine; credentials are never read or printed here.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { planUploads } from './publish-plan.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const bucket = arg('bucket');
if (!bucket || !/^breeva-/.test(bucket)) throw new Error('--bucket must be a breeva-* bucket');
const root = arg('root', 'D:/breeva-ml-data/field');
const regions = arg('region', 'badung_denpasar,kota_bogor').split(',');
const withRuns = process.argv.includes('--with-runs');
const plan = planUploads(root, regions).filter((u) => withRuns || !u.key.startsWith('v/'));
const tmp = mkdtempSync(join(tmpdir(), 'breeva-publish-'));
for (const u of plan) {
  // brotli entries go up compressed with Content-Encoding: br (publish-plan.mjs says which)
  const local = u.encoding === 'br' ? join(tmp, u.key.replace(/\//g, '_') + '.br') : u.local;
  if (u.encoding === 'br' && !process.argv.includes('--dry')) {
    writeFileSync(local, brotliCompressSync(readFileSync(u.local), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  }
  const cmd = ['s3', 'cp', local, `s3://${bucket}/${u.key}`, '--cache-control', u.cacheControl, '--content-type', u.contentType,
    ...(u.encoding ? ['--content-encoding', u.encoding] : []), '--only-show-errors'];
  if (process.argv.includes('--dry')) { console.log('aws', cmd.join(' ')); continue; }
  execFileSync('aws', cmd, { stdio: 'inherit' });
  console.log(`uploaded ${u.key}${u.encoding ? ` (${u.encoding})` : ''}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ bucket, files: plan.length, regions }));
