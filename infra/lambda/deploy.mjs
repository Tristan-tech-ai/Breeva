#!/usr/bin/env node
/**
 * Build, zip and deploy the hourly field builder (stack breeva-builder, ap-southeast-1).
 *
 *   node infra/lambda/deploy.mjs            # bundle -> lambda/field-builder-<sha>.zip in the field bucket -> stack deploy
 *   node infra/lambda/deploy.mjs --dry-run  # bundle and zip only, print the key
 *
 * The code key carries the content hash, so CloudFormation updates the function exactly when the bundle changed.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { zipFiles } from './zip.mjs';

const REGION = 'ap-southeast-1';
const BUCKET = 'breeva-field-422509704741';
const STACK = 'breeva-builder';
const dry = process.argv.includes('--dry-run');
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const aws = (args, quiet = false) =>
  execFileSync('aws', [...args, '--region', REGION], { env, stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'] });

execFileSync(process.execPath, ['infra/lambda/build.mjs'], { stdio: 'inherit' });
const zip = zipFiles([{ name: 'index.mjs', data: readFileSync('infra/lambda/dist/index.mjs') }]);
const sha = createHash('sha256').update(zip).digest('hex').slice(0, 16);
const key = `lambda/field-builder-${sha}.zip`;
writeFileSync('infra/lambda/dist/bundle.zip', zip);
console.log(JSON.stringify({ key, bytes: zip.length }));
if (dry) process.exit(0);

let present = true;
try { aws(['s3api', 'head-object', '--bucket', BUCKET, '--key', key], true); } catch { present = false; }
if (!present) aws(['s3', 'cp', 'infra/lambda/dist/bundle.zip', `s3://${BUCKET}/${key}`, '--no-progress']);
aws(['cloudformation', 'deploy', '--template-file', 'infra/aws/breeva-builder.yaml', '--stack-name', STACK,
  '--capabilities', 'CAPABILITY_NAMED_IAM', '--parameter-overrides', `CodeKey=${key}`, '--tags', 'project=breeva',
  '--no-fail-on-empty-changeset']);
