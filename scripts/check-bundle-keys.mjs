#!/usr/bin/env node
// Builds the client with canary values for every VITE_ variable that must stay server-side, then fails if any
// canary shows up in the output. A plain grep of dist/ cannot fail on a machine without real keys; this can.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Public by design: the Supabase URL and anon key are protected by row-level security; the OAuth client id is public.
const PUBLIC = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_GOOGLE_CLIENT_ID', 'VITE_APP_URL', 'VITE_CARTO_BASEMAP_KEY']);
const SECRET = [
  'VITE_GEMINI_API_KEY', 'VITE_OPENROUTESERVICE_API_KEY', 'VITE_ORS_API_KEY', 'VITE_FOURSQUARE_API_KEY',
  'VITE_GEOAPIFY_API_KEY', 'VITE_WAQI_TOKEN', 'VITE_IQAIR_API_KEY', 'VITE_SEARCHAPI_KEY', 'VITE_TOMTOM_API_KEY',
  'VITE_ANTHROPIC_API_KEY', 'VITE_OPENAQ_API_KEY',
].filter((n) => !PUBLIC.has(n));

const canary = (name) => `CANARY_${name}_d41d8cd9`;
const outDir = mkdtempSync(join(tmpdir(), 'breeva-bundle-'));
const env = { ...process.env };
for (const n of SECRET) env[n] = canary(n);

try {
  execFileSync('pnpm', ['-s', 'exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    env, stdio: 'inherit', shell: process.platform === 'win32',
  });
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(outDir);
  const leaks = [];
  for (const f of files) {
    const text = readFileSync(f, 'latin1');
    for (const n of SECRET) if (text.includes(canary(n))) leaks.push(`${n} in ${f.slice(outDir.length + 1)}`);
    // Known key shapes that must never be inlined, whatever the variable name.
    if (/AIza[0-9A-Za-z_-]{35}/.test(text)) leaks.push(`Google API key shape in ${f.slice(outDir.length + 1)}`);
    if (/sk-ant-[0-9A-Za-z_-]{20,}/.test(text)) leaks.push(`Anthropic key shape in ${f.slice(outDir.length + 1)}`);
  }
  if (leaks.length) {
    console.error(`bundle key check FAILED: ${leaks.length} leak(s)\n  ` + leaks.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log(`bundle key check ok: ${SECRET.length} server-side variables, ${files.length} files, no canary found`);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
