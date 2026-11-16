#!/usr/bin/env node
/**
 * Bundle the hourly field builder for AWS Lambda (Node.js 22): one ES module, the AWS SDK left to the runtime.
 *
 *   node infra/lambda/build.mjs      ->  infra/lambda/dist/index.mjs (+ size report)
 * Zip and upload are done by infra/lambda/deploy.mjs.
 */
import { build } from 'esbuild';
import { statSync } from 'node:fs';

const outfile = 'infra/lambda/dist/index.mjs';
await build({
  entryPoints: ['infra/lambda/field-builder.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['@aws-sdk/*'],
  // some bundled modules use require(); give the ES module a require for Node built-ins
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log(JSON.stringify({ outfile, bytes: statSync(outfile).size }));
