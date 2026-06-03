// IndexNow ping — tells Bing + Yandex (and any IndexNow participant) to (re)crawl
// Breeva's public URLs immediately, instead of waiting for an organic crawl.
//
// Reads the key from the `public/<hex>.txt` key file and the URL list from
// public/sitemap.xml (single source of truth), then POSTs to api.indexnow.org.
// No deps. Run AFTER deploying so https://breeva.site/<key>.txt is live (IndexNow
// fetches the key file to verify ownership; an unreachable key = rejected).
//
//   node scripts/indexnow-ping.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HOST = 'breeva.site';
const PUB = join(process.cwd(), 'public');

const keyFile = readdirSync(PUB).find((f) => /^[a-f0-9]{8,128}\.txt$/.test(f));
if (!keyFile) {
  console.error('[indexnow] no key file (hex name, .txt) found in public/ — create one first.');
  process.exit(1);
}
const key = keyFile.replace(/\.txt$/, '');

const sitemap = readFileSync(join(PUB, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].trim());
if (urlList.length === 0) {
  console.error('[indexnow] no <loc> URLs in public/sitemap.xml');
  process.exit(1);
}

const payload = { host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList };
console.log(`[indexnow] key=${key} keyLocation=${payload.keyLocation}`);
console.log(`[indexnow] submitting ${urlList.length} URLs:\n  ${urlList.join('\n  ')}`);

const res = await fetch('https://api.indexnow.org/IndexNow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});
const body = await res.text().catch(() => '');
console.log(`[indexnow] HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`);
// 200 = accepted, 202 = accepted/pending validation. Anything else is a failure.
if (res.status !== 200 && res.status !== 202) process.exit(1);
console.log('[indexnow] ✓ submitted');
