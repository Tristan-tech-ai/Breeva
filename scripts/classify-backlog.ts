/**
 * Local backlog classifier — multi-key × multi-model rotation.
 *
 * Bypasses Vercel 10s timeout by running directly from PC, hits Supabase REST
 * + Gemini API directly. Rotates across all configured API keys, and within
 * each key tries models in descending RPD order (so 500-RPD lite model gets
 * spent first, then 20-RPD ones).
 *
 * Run:
 *   pnpm classify:backlog
 *   pnpm classify:backlog -- --regions=jakarta --batch=100
 *   pnpm classify:backlog -- --batch=50 --dry-run
 *
 * Quota state is persisted to .cache/classify-quota.json (gitignored). It
 * tracks per-(key, model) RPD usage so the script can be killed + restarted
 * without re-burning quota on already-saturated combos. State resets at
 * Pacific midnight (Google quota reset boundary).
 */

import { config as loadEnv } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Load .env.local first (overrides .env), then .env
loadEnv({ path: '.env.local' });
loadEnv();

// ─── Config ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEYS = (process.env.GEMINI_API_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (KEYS.length === 0) {
  throw new Error('Missing GEMINI_API_KEYS (comma-separated)');
}

function arg(name: string, dflt: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : dflt;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const REGIONS = arg('regions', 'jakarta,bali,bandung,surabaya')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const BATCH = Math.max(1, Number(arg('batch', '100')));
const DRY_RUN = hasFlag('dry-run');

interface ModelSpec {
  id: string;
  rpd: number; // requests per day (free tier per key)
  rpm: number; // requests per minute (used for self-throttling)
}

// Listed in descending RPD so highest-yield model gets spent first per key.
// If a model 404s (not yet released for this key), it auto-disables.
const MODELS: ModelSpec[] = [
  { id: 'gemini-3.1-flash-lite', rpd: 500, rpm: 15 },
  { id: 'gemini-2.5-flash', rpd: 20, rpm: 5 },
  { id: 'gemini-2.5-flash-lite', rpd: 20, rpm: 10 },
  // gemini-3-flash listed in AI Studio dashboard but not yet exposed via
  // v1beta API (404). Re-enable when Google releases it.
];

// ─── Quota state (persist across runs within same Pacific day) ───
interface QuotaState {
  day: string;
  usage: Record<string, Record<string, number>>;
  disabled: Record<string, string[]>;
}

const STATE_PATH = '.cache/classify-quota.json';

function todayPT(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
}

function loadState(): QuotaState {
  try {
    const j: QuotaState = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    if (j.day === todayPT()) return j;
  } catch {
    /* missing or invalid */
  }
  return { day: todayPT(), usage: {}, disabled: {} };
}

function saveState(): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

const state = loadState();
const lastCallAt = new Map<string, number>();

function pickModel(keyIdx: number): ModelSpec | null {
  const k = String(keyIdx);
  for (const m of MODELS) {
    if (state.disabled[k]?.includes(m.id)) continue;
    const used = state.usage[k]?.[m.id] ?? 0;
    if (used >= m.rpd) continue;
    return m;
  }
  return null;
}

function markUsed(keyIdx: number, model: string): void {
  const k = String(keyIdx);
  state.usage[k] ??= {};
  state.usage[k][model] = (state.usage[k][model] ?? 0) + 1;
  saveState();
}

function markDisabled(keyIdx: number, model: string): void {
  const k = String(keyIdx);
  state.disabled[k] ??= [];
  if (!state.disabled[k].includes(model)) state.disabled[k].push(model);
  saveState();
}

async function rateLimit(keyIdx: number, m: ModelSpec): Promise<void> {
  const k = `${keyIdx}:${m.id}`;
  const minIntervalMs = 60_000 / m.rpm + 250;
  const since = Date.now() - (lastCallAt.get(k) ?? 0);
  if (since < minIntervalMs) {
    await new Promise((r) => setTimeout(r, minIntervalMs - since));
  }
  lastCallAt.set(k, Date.now());
}

// ─── Supabase cursor (in-process shared) ─────────────────────
// Each region has a cursor advancing by osm_way_id. Workers compete for
// fetchNext() under a tiny busy-wait lock so two workers never grab the
// same rows. Updates lag behind cursor advance, but since we filter on
// `ai_classified_at IS NULL` (and our query advances past already-fetched
// IDs regardless), there's no double-classification risk.
const cursor: Record<string, number> = Object.fromEntries(REGIONS.map((r) => [r, -1]));
const exhausted = new Set<string>();
// Tracks regions that went through one full pass with cursor.gt advancing —
// reaching "no more rows" the first time. We then reset the cursor and do a
// second pass to pick up rows that were skipped due to transient 503/parse
// errors mid-pass. If the second pass also finds nothing, region is truly done.
const passedOnce = new Set<string>();
let cursorLock = false;

interface UnclassifiedRoad {
  osm_way_id: number;
  highway: string;
  name: string | null;
  width: number | null;
  lanes: number | null;
  canyon_ratio: number | null;
  landuse_proxy: string | null;
  surface: string | null;
  traffic_base_estimate: number | null;
}

async function fetchNext(): Promise<{ region: string; roads: UnclassifiedRoad[] } | null> {
  while (cursorLock) await new Promise((r) => setTimeout(r, 20));
  cursorLock = true;
  try {
    for (const region of REGIONS) {
      if (exhausted.has(region)) continue;
      const after = cursor[region];
      const url =
        `${SUPABASE_URL}/rest/v1/road_segments` +
        `?region=eq.${encodeURIComponent(region)}` +
        `&ai_classified_at=is.null` +
        `&osm_way_id=gt.${after}` +
        `&select=osm_way_id,highway,name,width,lanes,canyon_ratio,landuse_proxy,surface,traffic_base_estimate` +
        `&limit=${BATCH}` +
        `&order=osm_way_id.asc`;
      const r = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY!,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });
      if (!r.ok) {
        console.error(`[fetch] ${region}: HTTP ${r.status}`);
        continue;
      }
      const roads: UnclassifiedRoad[] = await r.json();
      if (roads.length === 0) {
        if (!passedOnce.has(region)) {
          // First pass complete — restart from start to retry rows that were
          // skipped due to transient 503/parse failures.
          passedOnce.add(region);
          cursor[region] = -1;
          console.log(`[fetch] ${region}: pass 1 done, restarting for retry pass`);
          continue;
        }
        // Second pass also empty → truly exhausted
        exhausted.add(region);
        continue;
      }
      cursor[region] = roads[roads.length - 1].osm_way_id;
      return { region, roads };
    }
    return null;
  } finally {
    cursorLock = false;
  }
}

// ─── Gemini call ─────────────────────────────────────────────
function buildPrompt(region: string, roads: UnclassifiedRoad[]): string {
  return `You are an urban air quality expert specializing in Indonesian cities.
Analyze these road segments and classify their likely pollution level.

For each road, consider:
1. Width: <3m = gang/lorong (very low traffic, clean), 3-5m = small alley, 5-8m = neighborhood road, >8m = main road
2. Highway class + lanes + surrounding landuse
3. If residential + narrow + name contains "gang"/"gg."/"lorong"/"lr." → gang = VERY CLEAN AIR (factor 0.05-0.15)
4. If near industrial/commercial → higher pollution even if residential (factor 1.1-1.5)
5. Canyon ratio: deep canyon + narrow = pollution trap (factor 1.3-1.8)
6. If width is NULL, estimate from highway class:
   - motorway/trunk = 15-25m, primary = 8-12m, secondary = 6-8m
   - tertiary = 5-7m, residential = 3-6m, living_street = 2-4m
7. Surface: unpaved/dirt = more PM10 dust

Classification categories:
- "highway" (motorway, trunk): factor 1.0-1.5
- "arterial" (primary, primary_link): factor 0.8-1.3
- "collector" (secondary, tertiary): factor 0.5-1.0
- "local_road" (wide residential, >6m): factor 0.3-0.6
- "neighborhood_road" (residential 4-6m): factor 0.15-0.35
- "alley" (residential 3-4m or named gang): factor 0.08-0.15
- "gang" (residential <3m or clearly gang/lorong): factor 0.03-0.10
- "pedestrian_only" (footway, cycleway, path): factor 0.0-0.02

Roads to classify (${roads.length} roads from ${region}):
${JSON.stringify(
  roads.map((r) => ({
    id: r.osm_way_id,
    hw: r.highway,
    n: r.name,
    w: r.width,
    l: r.lanes,
    cr: r.canyon_ratio,
    lu: r.landuse_proxy,
    sf: r.surface,
    tb: r.traffic_base_estimate,
  })),
)}

Return a JSON array where each element has:
{ "id": number, "mc": string (micro_class), "pf": number (pollution_factor 0.0-2.0), "c": number (confidence 0-1) }`;
}

interface GeminiResult {
  ok: boolean;
  text?: string;
  status?: number;
  error?: string;
}

async function callGemini(key: string, model: string, prompt: string): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 16384,
        },
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      return { ok: false, status: r.status, error: err };
    }
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

function safeParseArray(raw: string): Array<{ id: number; mc: string; pf: number }> | null {
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
  } catch {
    /* try fallbacks */
  }
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      if (Array.isArray(j)) return j;
    } catch {
      /* continue */
    }
  }
  const a = raw.indexOf('[');
  const b = raw.lastIndexOf(']');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(raw.slice(a, b + 1));
      if (Array.isArray(j)) return j;
    } catch {
      /* give up */
    }
  }
  return null;
}

const VALID_CLASSES = new Set([
  'highway',
  'arterial',
  'collector',
  'local_road',
  'neighborhood_road',
  'alley',
  'gang',
  'pedestrian_only',
]);

async function updateRow(osmWayId: number, mc: string, pf: number): Promise<boolean> {
  if (DRY_RUN) return true;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/road_segments?osm_way_id=eq.${osmWayId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        micro_class: mc,
        ai_pollution_factor: pf,
        ai_classified_at: new Date().toISOString(),
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function applyUpdates(parsed: Array<{ id: number; mc: string; pf: number }>): Promise<number> {
  let saved = 0;
  const CHUNK = 10;
  for (let i = 0; i < parsed.length; i += CHUNK) {
    const slice = parsed.slice(i, i + CHUNK);
    const oks = await Promise.all(
      slice.map((r) => {
        if (!r.id || !r.mc || r.pf == null) return Promise.resolve(false);
        const mc = VALID_CLASSES.has(r.mc) ? r.mc : 'local_road';
        const pf = Math.max(0, Math.min(2.0, Number(r.pf)));
        return updateRow(r.id, mc, pf);
      }),
    );
    saved += oks.filter(Boolean).length;
  }
  return saved;
}

// ─── Worker loop ─────────────────────────────────────────────
let totalClassified = 0;
let totalCalls = 0;
const startedAt = Date.now();

// One worker per (key, model) combination — they run truly in parallel.
// Each respects its own RPD/RPM quota. When this combo is exhausted (RPD
// hit, 404 disabled, 429 quota), worker exits. Others keep going on their
// own quotas. Effective parallelism = KEYS × MODELS = up to 24 in flight.
async function worker(keyIdx: number, m: ModelSpec): Promise<void> {
  const k = String(keyIdx);
  const tag = `K${keyIdx}/${m.id}`;
  while (true) {
    // Per-worker quota check (no shared model picking)
    if (state.disabled[k]?.includes(m.id)) {
      console.log(`[${tag}] disabled, exiting`);
      return;
    }
    const used = state.usage[k]?.[m.id] ?? 0;
    if (used >= m.rpd) {
      console.log(`[${tag}] RPD limit reached (${used}/${m.rpd}), exiting`);
      return;
    }

    const batch = await fetchNext();
    if (!batch) {
      console.log(`[${tag}] no more unclassified rows`);
      return;
    }

    await rateLimit(keyIdx, m);
    markUsed(keyIdx, m.id);
    totalCalls += 1;

    const t0 = Date.now();
    const result = await callGemini(KEYS[keyIdx], m.id, buildPrompt(batch.region, batch.roads));
    const latency = Date.now() - t0;

    if (!result.ok) {
      const errSnip = (result.error ?? '').slice(0, 120).replace(/\s+/g, ' ');
      console.log(`[${tag}] FAIL ${result.status} ${errSnip}`);
      if (result.status === 404 || result.status === 400) markDisabled(keyIdx, m.id);
      if (result.status === 429) {
        // Force RPD counter to limit so this combo is skipped today
        state.usage[k] ??= {};
        state.usage[k][m.id] = m.rpd;
        saveState();
      }
      // For 503/500: random backoff so all workers don't retry in lockstep
      if (result.status === 503 || result.status === 500) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 4000));
      }
      continue;
    }

    const parsed = safeParseArray(result.text ?? '');
    if (!parsed) {
      console.log(`[${tag}] parse fail | preview: ${(result.text ?? '').slice(0, 160).replace(/\s+/g, ' ')}`);
      continue;
    }

    const saved = await applyUpdates(parsed);
    totalClassified += saved;

    const elapsedMin = (Date.now() - startedAt) / 60_000;
    const rate = totalClassified / Math.max(elapsedMin, 0.01);
    console.log(
      `[${tag}] ${batch.region} +${saved}/${batch.roads.length} | ${latency}ms | total ${totalClassified} | ${rate.toFixed(0)}/min | calls ${totalCalls}`,
    );
  }
}

// ─── Entry ───────────────────────────────────────────────────
const workerCount = KEYS.length * MODELS.length;
console.log(
  `Starting backlog classifier: ${KEYS.length} keys × ${MODELS.length} models = ${workerCount} workers | regions=[${REGIONS.join(', ')}] | batch=${BATCH}${DRY_RUN ? ' | DRY-RUN' : ''}`,
);
console.log(`Quota state: ${STATE_PATH} (day=${state.day} PT)`);

const allWorkers: Promise<void>[] = [];
for (let i = 0; i < KEYS.length; i++) {
  for (const m of MODELS) {
    allWorkers.push(worker(i, m));
  }
}

void Promise.all(allWorkers).then(() => {
  const elapsedMin = (Date.now() - startedAt) / 60_000;
  console.log(`\nDone. Classified ${totalClassified} in ${elapsedMin.toFixed(1)} min (${totalCalls} API calls).`);
  console.log(`Final usage: ${JSON.stringify(state.usage)}`);
});
