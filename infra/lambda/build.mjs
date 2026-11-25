#!/usr/bin/env node
/**
 * Bundle the hourly field builder for AWS Lambda (Node.js 22): one ES module, the AWS SDK left to the runtime.
 *
 *   node infra/lambda/build.mjs      ->  infra/lambda/dist/index.mjs (+ size report)
 * Zip and upload are done by infra/lambda/deploy.mjs.
 */
import { build } from 'esbuild';
import { copyFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
// N-36: the Open-Meteo file reader loads om_file_format.node.wasm next to the bundle (new URL(..., import.meta.url))
// pnpm keeps the wasm package beside the reader's real folder (node_modules/.pnpm/.../node_modules/@openmeteo/)
const readerDir = realpathSync('node_modules/@openmeteo/file-reader');
const wasmSrc = join(dirname(readerDir), 'file-format-wasm/dist/om_file_format.node.wasm');
copyFileSync(wasmSrc, 'infra/lambda/dist/om_file_format.node.wasm');
console.log(JSON.stringify({ outfile, bytes: statSync(outfile).size, wasm: statSync('infra/lambda/dist/om_file_format.node.wasm').size }));
