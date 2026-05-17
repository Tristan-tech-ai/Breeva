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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Load .env.local first (overrides .env), then .env
loadEnv({ path: '.env.local' });
loadEnv();

// ─── Config ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEYS = (process.env.GEMINI_API_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
// Groq raw keys from env; effective slice controlled by --groq-keys CLI flag
// (default = all available). Empirically 6 simultaneous keys triggered
// IP-level shared rate limit (Groq's edge throttles by source IP across keys
// belonging to same org/billing entity), producing ~99% 429 fail rate. Single
// key bypasses that IP bucket and can saturate per-key TPM cap (~12K TPM →
// 25 RPM × ~480 tok/call) for ~600 rows/min sustained from one key alone.
const GROQ_KEYS_RAW = (process.env.GROQ_API_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
// Cerebras Inference (api.cerebras.ai). Free tier 30 RPM / 60K TPM / 1M TPD
// PER ACCOUNT (not org-shared like Groq) — multiple keys from same IP are
// fully independent. With 6 keys × 30 RPM × batch=20 = up to 3600 rows/min
// theoretical; real cap is TPM (60K) × 6 = 360K tok/min from this provider.
const CEREBRAS_KEYS = (process.env.CEREBRAS_API_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

// Local vLLM endpoint (WSL2). Empty when LOCAL_VLLM_URL unset → local disabled.
// Concurrency = LOCAL_VLLM_WORKERS (fake keys) so multiple in-flight requests
// can saturate vLLM's continuous batching on a single GPU.
const LOCAL_VLLM_URL = process.env.LOCAL_VLLM_URL ?? '';
const LOCAL_VLLM_MODEL = process.env.LOCAL_VLLM_MODEL ?? 'Qwen/Qwen2.5-14B-Instruct-AWQ';
const LOCAL_VLLM_WORKERS = Math.max(0, Number(process.env.LOCAL_VLLM_WORKERS ?? '6'));
const LOCAL_KEYS = LOCAL_VLLM_URL
  ? Array.from({ length: LOCAL_VLLM_WORKERS }, (_, i) => `vllm-slot-${i}`)
  : [];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (
  GEMINI_KEYS.length === 0 &&
  GROQ_KEYS_RAW.length === 0 &&
  CEREBRAS_KEYS.length === 0 &&
  LOCAL_KEYS.length === 0
) {
  throw new Error('Missing all of GEMINI_API_KEYS, GROQ_API_KEYS, CEREBRAS_API_KEYS, LOCAL_VLLM_URL');
}

// Backwards-compat alias (some helpers reference KEYS — kept for stagger calc)
const KEYS = GEMINI_KEYS;

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

// Slice Groq keys: avoid IP-level throttle storm from too many simultaneous
// keys hitting Groq's edge from same source IP. `--groq-keys=1` recommended
// based on observed 99% 429 rate when running 6 keys parallel.
const GROQ_KEYS_LIMIT = Math.max(0, Number(arg('groq-keys', String(GROQ_KEYS_RAW.length))));
const GROQ_KEYS = GROQ_KEYS_RAW.slice(0, GROQ_KEYS_LIMIT);

type ProviderName = 'gemini' | 'groq' | 'cerebras' | 'local';

interface ModelSpec {
  id: string;
  rpd: number; // requests per day (free tier per key)
  rpm: number; // requests per minute (used for self-throttling)
  provider: ProviderName;
  // Per-model batch cap. Groq free-tier 70B has ~6K token per-request limit;
  // ~25 rows × ~200 tok = 5K input + 1K instruction fits comfortably. Gemini
  // accepts 100+ rows per call. Worker passes this to fetchNext().
  maxBatchSize?: number;
}

// Listed in descending RPD so highest-yield model gets spent first per key.
// If a model 404s (not yet released for this key), it auto-disables.
// Defaulting to single model to match worker count that empirically didn't
// trigger Google anti-burst (~18 in-flight). When KEYS is small (≤6), bump
// to multi-model for more throughput. Override via env GEMINI_MODELS.
const GEMINI_MODELS_FULL: ModelSpec[] = [
  { id: 'gemini-3.1-flash-lite', rpd: 500, rpm: 15, provider: 'gemini' },
  { id: 'gemini-2.5-flash', rpd: 20, rpm: 5, provider: 'gemini' },
  { id: 'gemini-2.5-flash-lite', rpd: 20, rpm: 10, provider: 'gemini' },
];
const GEMINI_MODELS_LITE: ModelSpec[] = [
  { id: 'gemini-3.1-flash-lite', rpd: 500, rpm: 15, provider: 'gemini' },
];

// Groq Llama 3.3 70B Versatile per live header probe:
//   x-ratelimit-limit-requests: 1000 (per ~1min bucket)
//   x-ratelimit-limit-tokens: 12000  (per ~200ms refill — effectively 12K TPM)
//   doc free tier: 30 RPM / 14.4k RPD / 100k TPD / 12K TPM
// With SINGLE key (no IP-bucket contention from parallel keys):
//   batch=20 × ~25 tok/row + 200 instruction = ~700 input + 300 output = 1K tok/call
//   25 RPM × 1K tok = 25K TPM → CAP at 12K TPM binding constraint
//   → effective 12 RPM × 20 rows = 240 rows/min sustained per key
//   → TPD budget 100K / 1K per call = 100 calls/day = 2000 rows/day from 1 key
// Real bottleneck is TPM, not RPM. rpm=25 + 12K TPM gives Groq's throttle a
// chance to refuse rather than us self-throttling too conservatively.
const GROQ_MODELS: ModelSpec[] = [
  { id: 'llama-3.3-70b-versatile', rpd: 14400, rpm: 25, provider: 'groq', maxBatchSize: 20 },
];

// Cerebras free-tier ACTUAL limits per key (per live header probe):
//   x-ratelimit-limit-requests-minute: 5     ← was assumed 30, real is 5
//   x-ratelimit-limit-requests-hour: 150     (2.5 RPM average sustained)
//   x-ratelimit-limit-requests-day: 2400
//   x-ratelimit-limit-tokens-minute: 30000
//   x-ratelimit-limit-tokens-hour/day: 1000000
// Setting rpm=3 (below per-minute cap but above hourly average) — workers
// burst up to 5 then briefly hit cap, balance recovers via 12s+ self-gaps.
// At rpm=3 × 6 keys = 18 RPM aggregate × 20 rows = 360 rows/min sustained.
// rpd=2000 stays under 2400 daily ceiling.
// max_tokens=1024 keeps token-budget reasonable (~1.5K tok/call).
const CEREBRAS_MODELS: ModelSpec[] = [
  { id: 'qwen-3-235b-a22b-instruct-2507', rpd: 2000, rpm: 3, provider: 'cerebras', maxBatchSize: 20 },
];

// Local vLLM (Qwen2.5-14B-Instruct-AWQ on RTX 5060 Ti). No rate limits — the
// only constraint is GPU throughput. rpm/rpd set astronomically high so the
// per-key/per-day caps never bind. maxBatchSize=15 keeps prompt under ~2K
// tokens, leaving ~2K headroom in the 4096 context window for output. vLLM's
// continuous batching fuses concurrent slot requests into one GPU pass.
const LOCAL_MODELS: ModelSpec[] = [
  { id: LOCAL_VLLM_MODEL, rpd: 10_000_000, rpm: 600, provider: 'local', maxBatchSize: 15 },
];

// Compose final MODELS list. 6 Groq keys × 2 models = 12 Groq workers.
// 18 Gemini keys × 1 model = 18 Gemini workers (post-burst calibration).
// Total ~30 workers — manageable with global throttle.
const GEMINI_MODELS_DEFAULT: ModelSpec[] =
  process.env.GEMINI_MODELS === 'full'
    ? GEMINI_MODELS_FULL
    : process.env.GEMINI_MODELS === 'lite'
      ? GEMINI_MODELS_LITE
      : GEMINI_KEYS.length > 6
        ? GEMINI_MODELS_LITE
        : GEMINI_MODELS_FULL;

const MODELS: ModelSpec[] = GEMINI_MODELS_DEFAULT;  // legacy alias

function keysFor(provider: ProviderName): string[] {
  if (provider === 'gemini') return GEMINI_KEYS;
  if (provider === 'groq') return GROQ_KEYS;
  if (provider === 'cerebras') return CEREBRAS_KEYS;
  return LOCAL_KEYS;
}

interface WorkerSpec { provider: ProviderName; keyIdx: number; model: ModelSpec; }

function allWorkerSpecs(): WorkerSpec[] {
  const specs: WorkerSpec[] = [];
  // Gemini workers
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    for (const m of GEMINI_MODELS_DEFAULT) {
      specs.push({ provider: 'gemini', keyIdx: i, model: m });
    }
  }
  // Groq workers
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    for (const m of GROQ_MODELS) {
      specs.push({ provider: 'groq', keyIdx: i, model: m });
    }
  }
  // Cerebras workers
  for (let i = 0; i < CEREBRAS_KEYS.length; i++) {
    for (const m of CEREBRAS_MODELS) {
      specs.push({ provider: 'cerebras', keyIdx: i, model: m });
    }
  }
  // Local vLLM workers (one spec per LOCAL_KEYS slot — slots are fake "keys"
  // so the existing per-key throttle / quota state plumbing works as-is. Real
  // concurrency limit is vLLM's --max-num-seqs.)
  for (let i = 0; i < LOCAL_KEYS.length; i++) {
    for (const m of LOCAL_MODELS) {
      specs.push({ provider: 'local', keyIdx: i, model: m });
    }
  }
  return specs;
}

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

// Debounced, atomic save. Plain writeFileSync into STATE_PATH crashed on
// Windows under heavy concurrent markUsed() traffic with EBUSY (Windows
// Defender / file-system races on rapid re-opens of the same handle). Two
// defenses:
//   1. Coalesce: schedule a single setTimeout; further saveState() calls
//      while one is queued are no-ops. State is in-memory anyway; the file
//      is just a crash-recovery checkpoint, so 1Hz is plenty.
//   2. Atomic + retry: write to STATE_PATH.tmp then rename. Rename is atomic
//      on same-volume Windows. If EBUSY still fires (AV holding handle),
//      requeue rather than crash.
let saveQueued = false;
function saveState(): void {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      const tmp = `${STATE_PATH}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, STATE_PATH);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOENT') {
        // Transient (Windows AV / handle races). Re-arm so the next save
        // attempts again rather than losing state.
        setTimeout(() => saveState(), 500);
      } else {
        throw e;
      }
    }
  }, 1000);
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

function markUsed(k: string, model: string): void {
  state.usage[k] ??= {};
  state.usage[k][model] = (state.usage[k][model] ?? 0) + 1;
  saveState();
}

function markDisabled(k: string, model: string): void {
  state.disabled[k] ??= [];
  if (!state.disabled[k].includes(model)) state.disabled[k].push(model);
  saveState();
}

async function rateLimit(k: string, m: ModelSpec): Promise<void> {
  const compound = `${k}:${m.id}`;
  const minIntervalMs = 60_000 / m.rpm + 250;
  const since = Date.now() - (lastCallAt.get(compound) ?? 0);
  if (since < minIntervalMs) {
    await new Promise((r) => setTimeout(r, minIntervalMs - since));
  }
  lastCallAt.set(compound, Date.now());
}

// Per-provider aggregate throttle. Gemini's IP/account anti-burst kicks in at
// ~20-30 RPM aggregate; 3000ms = 20 RPM ceiling. (Earlier 2000ms triggered
// blanket 429 storms even when no individual key was over quota.) Groq
// turned out to *also* throttle by source IP across keys (observed 99% 429
// rate with 6 keys parallel from same IP). With --groq-keys=1 (default
// recommendation), per-key rpm=25 + 12K TPM dominates — global 800ms
// (75 RPM ceiling) is loose enough not to bind.
const GEMINI_GLOBAL_INTERVAL_MS = Number(arg('global-interval-ms', '3000'));
const GROQ_GLOBAL_INTERVAL_MS = Number(arg('groq-interval-ms', '800'));
// Cerebras 6 keys × 30 RPM = 180 RPM theoretical, but 400ms (150 RPM)
// caused the shared HTTP connection pool to get stuck after ~5min of burst
// traffic — all 6 workers silently hung mid-fetch with no error. 1000ms
// (60 RPM aggregate, 1200 rows/min × 20-batch) is conservative; per-call
// AbortSignal 30s timeout catches any stuck connections that slip through.
const CEREBRAS_GLOBAL_INTERVAL_MS = Number(arg('cerebras-interval-ms', '1000'));
// Local vLLM has no rate limit; only GPU throughput. Tiny interval (50ms)
// just smooths bursts so vLLM's queue doesn't get flooded at startup.
const LOCAL_GLOBAL_INTERVAL_MS = Number(arg('local-interval-ms', '50'));

const providerLastCallAt: Record<ProviderName, number> = { gemini: 0, groq: 0, cerebras: 0, local: 0 };
const providerQueue: Record<ProviderName, Promise<void>> = {
  gemini: Promise.resolve(),
  groq: Promise.resolve(),
  cerebras: Promise.resolve(),
  local: Promise.resolve(),
};

function globalThrottle(provider: ProviderName): Promise<void> {
  // Chain: each caller waits for prior caller's wakeup + their own gap. This
  // serializes the "claim a slot" step so workers can't all see the same
  // lastGlobalCallAt and bypass the throttle.
  const interval =
    provider === 'gemini'
      ? GEMINI_GLOBAL_INTERVAL_MS
      : provider === 'groq'
        ? GROQ_GLOBAL_INTERVAL_MS
        : provider === 'cerebras'
          ? CEREBRAS_GLOBAL_INTERVAL_MS
          : LOCAL_GLOBAL_INTERVAL_MS;
  const next = providerQueue[provider].then(async () => {
    const now = Date.now();
    const since = now - providerLastCallAt[provider];
    if (since < interval) {
      await new Promise((r) => setTimeout(r, interval - since));
    }
    providerLastCallAt[provider] = Date.now();
  });
  providerQueue[provider] = next.catch(() => undefined);
  return next;
}

// ─── Supabase cursor (in-process shared) ─────────────────────
// Each region has a cursor advancing by osm_way_id. Workers compete for
// fetchNext() under a tiny busy-wait lock so two workers never grab the
// same rows. Updates lag behind cursor advance, but since we filter on
// `ai_classified_at IS NULL` (and our query advances past already-fetched
// IDs regardless), there's no double-classification risk.
const cursor: Record<string, number> = Object.fromEntries(REGIONS.map((r) => [r, -1]));
const exhausted = new Set<string>();
const passedOnce = new Set<string>();
// Round-robin region pointer so workers spread evenly across regions instead
// of all hammering REGIONS[0] until exhausted. Advances after each successful
// fetch.
let regionRR = 0;
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

async function fetchNext(batchSize: number = BATCH): Promise<{ region: string; roads: UnclassifiedRoad[] } | null> {
  while (cursorLock) await new Promise((r) => setTimeout(r, 20));
  cursorLock = true;
  try {
    for (let i = 0; i < REGIONS.length; i++) {
      const region = REGIONS[(regionRR + i) % REGIONS.length];
      if (exhausted.has(region)) continue;
      const after = cursor[region];
      const url =
        `${SUPABASE_URL}/rest/v1/road_segments` +
        `?region=eq.${encodeURIComponent(region)}` +
        `&ai_classified_at=is.null` +
        `&osm_way_id=gt.${after}` +
        `&select=osm_way_id,highway,name,width,lanes,canyon_ratio,landuse_proxy,surface,traffic_base_estimate` +
        `&limit=${batchSize}` +
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
      regionRR = (regionRR + 1) % REGIONS.length;
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
  // Set on 429 only. true = real per-day quota hit (remaining-requests=0 in
  // response header). false/undef = transient TPM/RPM/burst — safe to retry.
  rpdExhausted?: boolean;
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

// Groq OpenAI-compatible chat completions
async function callGroq(key: string, model: string, prompt: string): Promise<GeminiResult> {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an urban air quality classifier. Respond ONLY with valid JSON array as instructed. No prose, no markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        // CRITICAL: Groq reserves max_tokens against the 12K TPM bucket up-front.
        // With max_tokens=8192 a single call drains ~9K of 12K → next call 429s
        // until 200ms refill. Actual output for batch=20 is ~500-800 tok, so
        // 1024 is generous + leaves ~10K headroom per minute (10-12 calls/min
        // sustained, the real cap on Groq throughput — RPM never bound).
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      // Distinguish RPD-exhaustion (real "your account is done for the day")
      // from TPM/RPM burst (transient — refills within ~60s). Groq returns
      // `x-ratelimit-remaining-requests` (RPD bucket) and
      // `x-ratelimit-remaining-tokens` (TPM bucket). Only the former at 0
      // means the key is dead for today; the latter being low just means
      // back off briefly.
      let rpdExhausted = false;
      if (r.status === 429) {
        const remReq = r.headers.get('x-ratelimit-remaining-requests');
        if (remReq !== null && Number(remReq) <= 0) rpdExhausted = true;
      }
      return { ok: false, status: r.status, error: err, rpdExhausted };
    }
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content ?? '';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

// Local vLLM (OpenAI-compatible). The `key` arg is a fake slot id (we don't
// auth against vLLM by default). LOCAL_VLLM_URL must be a base url ending
// with `/v1` (we append `/chat/completions`).
async function callLocal(_key: string, model: string, prompt: string): Promise<GeminiResult> {
  const url = `${LOCAL_VLLM_URL.replace(/\/$/, '')}/chat/completions`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // vLLM accepts any token by default; harmless if --api-key isn't set.
        Authorization: 'Bearer EMPTY',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an urban air quality classifier. Respond ONLY with valid JSON array as instructed. No prose, no markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        // Output budget: 15 rows × ~40 tok/row = ~600 tok worst case. 1024
        // gives margin; combined with ~2K prompt we stay well under vLLM's
        // 4096 max-model-len.
        max_tokens: 1024,
        // No response_format: vLLM's `json_object` guided decoding forces an
        // object root, which breaks our array-shaped expected output. The
        // system prompt is strict enough — safeParseArray handles either form.
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      return { ok: false, status: r.status, error: err };
    }
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content ?? '';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

// Cerebras Inference (OpenAI-compatible). Same lesson as Groq: max_tokens is
// pre-reserved against the 60K TPM bucket, so set tight (1024 is generous
// for batch=20 × ~30 tok/row JSON output). Free tier is per-account, not
// org-shared, so multiple keys multiply throughput linearly.
async function callCerebras(key: string, model: string, prompt: string): Promise<GeminiResult> {
  const url = 'https://api.cerebras.ai/v1/chat/completions';
  // 30s hard timeout via AbortController. Without this, Node's fetch hangs
  // forever if Cerebras silently drops the connection (observed: 32 OK calls
  // then all 6 workers stuck indefinitely with no error and no timeout — the
  // shared connection pool poisoned by a half-broken keep-alive).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an urban air quality classifier. Respond ONLY with valid JSON array as instructed. No prose, no markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const err = await r.text();
      // Cerebras returns OpenAI-style ratelimit headers. Treat both
      // remaining-requests=0 and "tokens per day" in error body as
      // day-exhausted signals.
      let rpdExhausted = false;
      if (r.status === 429) {
        const remReq = r.headers.get('x-ratelimit-remaining-requests');
        if (remReq !== null && Number(remReq) <= 0) rpdExhausted = true;
        if (/per day|TPD|daily/i.test(err)) rpdExhausted = true;
      }
      return { ok: false, status: r.status, error: err, rpdExhausted };
    }
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content ?? '';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function callProvider(provider: ProviderName, key: string, model: string, prompt: string): Promise<GeminiResult> {
  if (provider === 'gemini') return callGemini(key, model, prompt);
  if (provider === 'groq') return callGroq(key, model, prompt);
  if (provider === 'cerebras') return callCerebras(key, model, prompt);
  return callLocal(key, model, prompt);
}

function safeParseArray(raw: string): Array<{ id: number; mc: string; pf: number }> | null {
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
    // Groq with response_format=json_object wraps array in `{results:[...]}` or
    // `{predictions:[...]}` or `{classifications:[...]}`. Try common keys.
    if (j && typeof j === 'object') {
      for (const key of ['results', 'predictions', 'classifications', 'data', 'items', 'roads']) {
        if (Array.isArray(j[key])) return j[key];
      }
      // If it's a single object with id/mc/pf, wrap it
      if (typeof j.id === 'number' && j.mc) return [j];
    }
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
// Track consecutive 429s per (key, model) — a single 429 can be transient
// (anti-burst from too many concurrent workers), not RPD exhaustion. Only
// mark a combo as exhausted after MANY in a row. Higher threshold avoids
// false-positive exhaustion during IP-level burst storms (Gemini's "Resource
// has been exhausted" message is generic across burst-429 and RPD-429).
const consec429 = new Map<string, number>();
const CONSEC_429_LIMIT = 10;

// One worker per (provider, key_idx, model) combination. Quota state keyed
// by "<provider>:<keyIdx>" to keep Gemini and Groq buckets separate.
async function worker(spec: WorkerSpec, startupDelayMs: number): Promise<void> {
  const { provider, keyIdx, model } = spec;
  const k = `${provider}:${keyIdx}`;
  const tagPrefix =
    provider === 'gemini' ? 'Gm' :
    provider === 'groq' ? 'Gq' :
    provider === 'cerebras' ? 'Cb' :
    'Lo';
  const tag = `${tagPrefix}${keyIdx}/${model.id.split('/').pop()}`;
  const keys = keysFor(provider);
  if (keyIdx >= keys.length) return;  // safety
  const apiKey = keys[keyIdx];

  if (startupDelayMs > 0) await new Promise((r) => setTimeout(r, startupDelayMs));
  while (true) {
    if (state.disabled[k]?.includes(model.id)) {
      console.log(`[${tag}] disabled, exiting`);
      return;
    }
    const used = state.usage[k]?.[model.id] ?? 0;
    if (used >= model.rpd) {
      console.log(`[${tag}] RPD limit reached (${used}/${model.rpd}), exiting`);
      return;
    }

    const batch = await fetchNext(model.maxBatchSize ?? BATCH);
    if (!batch) {
      console.log(`[${tag}] no more unclassified rows`);
      return;
    }

    await rateLimit(k, model);  // per-(provider,key,model) RPM throttle
    await globalThrottle(provider);
    markUsed(k, model.id);
    totalCalls += 1;

    const t0 = Date.now();
    const result = await callProvider(provider, apiKey, model.id, buildPrompt(batch.region, batch.roads));
    const latency = Date.now() - t0;

    if (!result.ok) {
      const errSnip = (result.error ?? '').slice(0, 400).replace(/\s+/g, ' ');
      console.log(`[${tag}] FAIL ${result.status} ${errSnip}`);
      if (result.status === 404 || result.status === 400) markDisabled(k, model.id);
      if (result.status === 403 || result.status === 401) {
        console.log(`[${tag}] ${result.status} (key flagged/invalid) → permanently disabled`);
        markDisabled(k, model.id);
      }
      if (result.status === 429) {
        // Authoritative signal first: Groq's response header. If the provider
        // tells us remaining-requests is 0 → key is genuinely done for the day.
        const n = (consec429.get(tag) ?? 0) + 1;
        consec429.set(tag, n);
        // Gemini doesn't expose remaining-requests headers, so we fall back
        // to the consec429 heuristic for it. Set Gemini's limit high (the
        // earlier 10 was already a survivable threshold). For Groq, the
        // heuristic is disabled — we trust the header signal alone.
        const consecExhausted = provider === 'gemini' && n >= CONSEC_429_LIMIT;
        if (result.rpdExhausted || consecExhausted) {
          const reason = result.rpdExhausted ? 'header says RPD=0' : `${n}x consec 429`;
          console.log(`[${tag}] ${reason} → marking exhausted for today`);
          state.usage[k] ??= {};
          state.usage[k][model.id] = model.rpd;
          saveState();
        } else {
          // Exponential-ish backoff with jitter — burst storms last 30-60s,
          // so a single 8s wait followed by another fire often re-collides.
          const base = Math.min(120_000, 15_000 * n);
          await new Promise((r) => setTimeout(r, base + Math.random() * 15_000));
        }
      } else if (result.status === 503 || result.status === 500) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 4000));
      }
      continue;
    }
    consec429.delete(tag);

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
const specs = allWorkerSpecs();
const geminiCount = specs.filter(s => s.provider === 'gemini').length;
const groqCount = specs.filter(s => s.provider === 'groq').length;
const cerebrasCount = specs.filter(s => s.provider === 'cerebras').length;
const localCount = specs.filter(s => s.provider === 'local').length;
console.log(
  `Starting backlog classifier: ${GEMINI_KEYS.length} Gemini + ${GROQ_KEYS.length} Groq + ${CEREBRAS_KEYS.length} Cerebras + ${LOCAL_KEYS.length} local slots = ${specs.length} workers (${geminiCount} Gm, ${groqCount} Gq, ${cerebrasCount} Cb, ${localCount} Lo) | regions=[${REGIONS.join(', ')}] | batch=${BATCH}${LOCAL_VLLM_URL ? ` | vllm=${LOCAL_VLLM_URL}` : ''}${DRY_RUN ? ' | DRY-RUN' : ''}`,
);
console.log(`Quota state: ${STATE_PATH} (day=${state.day} PT)`);

// Stagger startup: with 30-50 workers all firing at once, anti-burst kicks in.
// ~150ms stagger spreads the initial wave.
const allWorkers: Promise<void>[] = [];
let staggerIdx = 0;
for (const spec of specs) {
  const delay = staggerIdx * 150;
  allWorkers.push(worker(spec, delay));
  staggerIdx++;
}

void Promise.all(allWorkers).then(() => {
  const elapsedMin = (Date.now() - startedAt) / 60_000;
  console.log(`\nDone. Classified ${totalClassified} in ${elapsedMin.toFixed(1)} min (${totalCalls} API calls).`);
  console.log(`Final usage: ${JSON.stringify(state.usage)}`);
});
