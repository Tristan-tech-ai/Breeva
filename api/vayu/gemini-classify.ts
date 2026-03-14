import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Gemini AI Road Classification — Batch endpoint.
 * Uses Gemini 3.1 Flash Lite (500 RPD, 15 RPM) to classify roads into
 * micro-categories (gang, alley, neighborhood, etc.) and assign
 * ai_pollution_factor for each road segment.
 *
 * POST /api/vayu/gemini-classify
 * Body: { region: string, batch_size?: number, offset?: number }
 *
 * Also handles temporal correction (Module B) and error analysis (Module C):
 * POST /api/vayu/gemini-classify?mode=temporal&region=jakarta
 * POST /api/vayu/gemini-classify?mode=error_analysis&region=jakarta
 *
 * Auth: Requires SUPABASE_SERVICE_ROLE_KEY in Authorization header.
 */

// ─── Redis helpers ──────────────────────────────────────────
async function redisGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.result ?? null;
  } catch { return null; }
}

async function redisSetEx(key: string, ttl: number, value: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* non-fatal */ }
}

// ─── Gemini API call ────────────────────────────────────────
async function callGemini(prompt: string, model = 'gemini-2.5-flash-lite-preview-06-17'): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('Gemini API error:', resp.status, err);
      return null;
    }

    const json = await resp.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (err) {
    console.error('Gemini call failed:', err);
    return null;
  }
}

// ─── Supabase helpers ───────────────────────────────────────
async function supabaseQuery(query: string, body?: unknown): Promise<unknown> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');

  const resp = await fetch(`${url}/rest/v1/${query}`, {
    method: body ? 'PATCH' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(body ? { Prefer: 'return=minimal' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase error: ${resp.status} ${text}`);
  }

  if (body) return null; // PATCH returns minimal
  return resp.json();
}

// ─── Fetch unclassified roads ───────────────────────────────
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

async function fetchUnclassifiedRoads(
  region: string,
  limit: number,
  offset: number
): Promise<UnclassifiedRoad[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];

  try {
    const resp = await fetch(
      `${url}/rest/v1/road_segments?region=eq.${encodeURIComponent(region)}&ai_classified_at=is.null&select=osm_way_id,highway,name,width,lanes,canyon_ratio,landuse_proxy,surface,traffic_base_estimate&limit=${limit}&offset=${offset}&order=osm_way_id.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

// ─── Update road classification in DB ───────────────────────
async function updateRoadClassification(
  osmWayId: number,
  microClass: string,
  pollutionFactor: number
): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    await fetch(
      `${url}/rest/v1/road_segments?osm_way_id=eq.${osmWayId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          micro_class: microClass,
          ai_pollution_factor: pollutionFactor,
          ai_classified_at: new Date().toISOString(),
        }),
      }
    );
  } catch { /* non-fatal */ }
}

// ─── Module A: Batch Road Classification ────────────────────
async function classifyRoads(region: string, batchSize: number, offset: number) {
  const roads = await fetchUnclassifiedRoads(region, batchSize, offset);
  if (roads.length === 0) {
    return { classified: 0, message: 'No unclassified roads found', results: [] };
  }

  const prompt = `You are an urban air quality expert specializing in Indonesian cities.
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
${JSON.stringify(roads.map(r => ({
  id: r.osm_way_id,
  hw: r.highway,
  n: r.name,
  w: r.width,
  l: r.lanes,
  cr: r.canyon_ratio,
  lu: r.landuse_proxy,
  sf: r.surface,
  tb: r.traffic_base_estimate,
})))}

Return a JSON array where each element has:
{ "id": number, "mc": string (micro_class), "pf": number (pollution_factor 0.0-2.0), "c": number (confidence 0-1) }`;

  const raw = await callGemini(prompt);
  if (!raw) {
    return { classified: 0, error: 'Gemini API call failed', results: [] };
  }

  let results: Array<{ id: number; mc: string; pf: number; c: number }>;
  try {
    results = JSON.parse(raw);
    if (!Array.isArray(results)) throw new Error('Not an array');
  } catch {
    return { classified: 0, error: 'Failed to parse Gemini response', raw_preview: raw.slice(0, 500), results: [] };
  }

  // Validate and persist
  const validClasses = ['highway', 'arterial', 'collector', 'local_road', 'neighborhood_road', 'alley', 'gang', 'pedestrian_only'];
  const savedResults: Array<{ osm_way_id: number; micro_class: string; pollution_factor: number }> = [];

  for (const r of results) {
    if (!r.id || !r.mc || r.pf == null) continue;
    const mc = validClasses.includes(r.mc) ? r.mc : 'local_road';
    const pf = Math.max(0, Math.min(2.0, r.pf));

    await updateRoadClassification(r.id, mc, pf);
    savedResults.push({ osm_way_id: r.id, micro_class: mc, pollution_factor: pf });
  }

  return {
    classified: savedResults.length,
    total_input: roads.length,
    region,
    results: savedResults,
  };
}

// ─── Module B: Temporal Pattern Correction ──────────────────
async function generateTemporalCorrection(region: string) {
  // Fetch last 7 days of WAQI data from Redis
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const key = `vayu:waqi_history:${region}:${d.toISOString().slice(0, 10)}`;
    const data = await redisGet(key);
    if (data) days.push(data);
  }

  const now = new Date();
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const month = now.getMonth() + 1;
  const season = (month >= 5 && month <= 10) ? 'dry (kemarau)' : 'wet (hujan)';

  const prompt = `You are a traffic and air quality prediction expert for ${region}, Indonesia.

${days.length > 0 ? `Last ${days.length} days of hourly WAQI station readings:\n${days.join('\n')}` : 'No recent WAQI history available. Use general knowledge of Indonesian traffic patterns.'}

Today's context:
- Day: ${dayOfWeek}
- Date: ${now.toISOString().slice(0, 10)}
- Season: ${season}
- Region: ${region}

Generate a 24-hour traffic correction factor array [0..23].
Base = 1.0 (average hour). Peak hours > 1.0, quiet hours < 1.0.

Consider:
1. Weekend vs weekday patterns (Sat/Sun lighter morning rush)
2. Indonesian school hours (06:30-07:00 start, 14:00-15:00 end)
3. Jum'at prayers (11:30-13:00 → slight dip)
4. Weather/season impact (${season}: ${month >= 5 && month <= 10 ? 'drier, more dust, biomass burning' : 'rain washout, less dust, sometimes flooding'})
5. Evening peak patterns (18:00-20:00 in ${region})

Return JSON: { "hourly_factors": [24 numbers], "reasoning": "brief explanation" }`;

  const raw = await callGemini(prompt, 'gemini-2.5-flash');
  if (!raw) {
    return { success: false, error: 'Gemini API call failed' };
  }

  let result: { hourly_factors: number[]; reasoning: string };
  try {
    result = JSON.parse(raw);
    if (!Array.isArray(result.hourly_factors) || result.hourly_factors.length !== 24) {
      throw new Error('Invalid hourly_factors array');
    }
  } catch {
    return { success: false, error: 'Failed to parse response', raw_preview: raw.slice(0, 500) };
  }

  // Cache with 12h TTL
  const today = now.toISOString().slice(0, 10);
  await redisSetEx(`vayu:temporal:${region}:${today}`, 43200, JSON.stringify(result));

  return {
    success: true,
    region,
    date: today,
    hourly_factors: result.hourly_factors,
    reasoning: result.reasoning,
  };
}

// ─── Module C: Residual Error Analysis ──────────────────────
async function analyzeErrors(region: string) {
  // Fetch accumulated prediction errors from Redis
  const errorsRaw = await redisGet(`vayu:errors:${region}:accumulated`);
  if (!errorsRaw) {
    return { success: false, error: 'No accumulated error data found' };
  }

  const prompt = `You are an air quality model calibration expert.

Here are accumulated prediction errors from the VAYU engine for ${region}, Indonesia.
Each entry shows: { road_class, hour, predicted_aqi, actual_aqi (from WAQI station), delta }.

Error data:
${errorsRaw}

Analyze the systematic biases and return a correction matrix.
For each (road_class, hour_range) combination, provide a correction factor.

Return JSON array:
[
  { "road_class": "motorway", "hour_range": "6-9", "factor": 0.95, "explanation": "slight over-prediction during morning rush" },
  ...
]

Only include entries where |factor - 1.0| > 0.05 (meaningful correction needed).`;

  const raw = await callGemini(prompt, 'gemini-2.5-flash');
  if (!raw) {
    return { success: false, error: 'Gemini API call failed' };
  }

  let corrections: Array<{ road_class: string; hour_range: string; factor: number; explanation: string }>;
  try {
    corrections = JSON.parse(raw);
    if (!Array.isArray(corrections)) throw new Error('Not an array');
  } catch {
    return { success: false, error: 'Failed to parse response', raw_preview: raw.slice(0, 500) };
  }

  // Store each correction in Redis with 7d TTL
  for (const c of corrections) {
    const hours = c.hour_range.split('-').map(Number);
    if (hours.length !== 2) continue;
    const factor = Math.max(0.5, Math.min(1.5, c.factor)); // safety clamp
    for (let h = hours[0]; h <= hours[1]; h++) {
      const key = `vayu:correction:${region}:${c.road_class}:${h}`;
      await redisSetEx(key, 604800, String(factor));
    }
  }

  return {
    success: true,
    region,
    corrections_applied: corrections.length,
    corrections,
  };
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Accept POST (manual/API) or GET (Vercel cron)
  const isCron = req.method === 'GET';

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use POST or GET (cron).' });
  }

  // Auth: POST requires service role key, GET (cron) requires CRON_SECRET
  const authHeader = req.headers.authorization;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret = process.env.CRON_SECRET;

  if (isCron) {
    // Vercel cron sends Authorization: Bearer <CRON_SECRET>
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  } else {
    if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const mode = (req.query.mode as string) || 'classify';

  try {
    switch (mode) {
      case 'classify': {
        const { region = 'bali', batch_size = 100, offset = 0 } = req.body || {};
        const result = await classifyRoads(
          String(region),
          Math.min(Number(batch_size) || 100, 200),
          Number(offset) || 0
        );
        return res.status(200).json(result);
      }

      case 'temporal': {
        const region = String(req.query.region || req.body?.region || 'jakarta');
        const result = await generateTemporalCorrection(region);
        return res.status(200).json(result);
      }

      case 'error_analysis': {
        const region = String(req.query.region || req.body?.region || 'jakarta');
        const result = await analyzeErrors(region);
        return res.status(200).json(result);
      }

      default:
        return res.status(400).json({ error: `Unknown mode: ${mode}. Use: classify, temporal, error_analysis` });
    }
  } catch (error) {
    console.error('Gemini classify error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
