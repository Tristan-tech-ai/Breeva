// ════════════════════════════════════════════════════════════════════════════
// Breeva — "Vayu" AI chat assistant (Supabase Edge Function, Deno runtime)
//
// Browser-facing Gemini STREAMING proxy. Keeps the paid Gemini key server-side
// (Supabase secret) and never touches the Vercel 12-function cap.
//
// Deploy:
//   npx supabase functions deploy chat --project-ref tqhdlcwiyqrnlrgjsymc --no-verify-jwt
//
// Auth: --no-verify-jwt at the gateway; this handler soft-gates on the public
//   anon key + a CORS origin allowlist (the real protection is that the Gemini
//   key never leaves the server). Works for logged-out map browsers.
//
// Protocol (Server-Sent Events, our own small schema — decoupled from Gemini):
//   event: token     data: {"t":"..."}            append to current bubble
//   event: tool_call data: {"name","args"}        pause → client runs action → re-call
//   event: error     data: {"message"}            graceful fallback
//   event: done      data: {"finishReason"}       finalize
// ════════════════════════════════════════════════════════════════════════════

// ─── Gemini key pool (mirror of gemini-classify) ───────────────────
function getKeyPool(): string[] {
  const multi = Deno.env.get('GEMINI_API_KEYS');
  if (multi) {
    const arr = multi.split(',').map((k) => k.trim()).filter(Boolean);
    if (arr.length > 0) return arr;
  }
  const single = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('VITE_GEMINI_API_KEY');
  return single ? [single] : [];
}
function pickStartKeyIdx(poolSize: number): number {
  const minute = Math.floor(Date.now() / 60_000);
  return ((minute % poolSize) + poolSize) % poolSize;
}
const MODEL = 'gemini-2.5-flash-lite';

// ─── Vayu persona + trimmed Breeva knowledge base (server-held) ────
const BREEVA_KB = `Breeva is a free Indonesian web app (PWA) for clean-air navigation. It maps air quality (AQI) for each road segment in real time, finds the cleanest walking route, forecasts the next 24 hours, and calculates the PM2.5 dose you inhale. Powered by the in-house VAYU engine (calibrates per-road AQI from a satellite + Open-Meteo baseline; estimates per-segment PM2.5 & NO2 with a confidence level).
Routes: three options per trip — Clean/"Bersih" (green = best air), Balanced/"Seimbang" (blue), Fast/"Cepat" (orange). Each shows distance, duration, an air-quality score, and an estimated exposure.
EcoPoints: rewards for walking and choosing clean routes; redeem them at eco-friendly merchants. Walking & cycling earn the most (zero emission). Points come from verified distance + daily quests + achievements.
Exposure (Paparan, at /paparan): inhaled PM2.5 dose along a route by age + activity, compared to the WHO 2021 24h guideline (15 µg/m³) and shown as a cigarette-equivalent (~660 µg inhaled ≈ 1 cigarette, Pope 2009). This comparison is illustrative, not medical.
Supported cities: Jakarta (Jabodetabek), Bali, Bandung, Surabaya, and other Indonesian cities.
Tips: air is worst at rush hour (07:00–09:00 & 17:00–19:00); routes near parks/green space are cleaner; walking 1 km saves ~120 g CO2 vs driving.
AQI bands: 0–50 Good, 51–100 Moderate, 101–150 Unhealthy for sensitive groups, 151+ Unhealthy.`;

// deno-lint-ignore no-explicit-any
function buildSystemPrompt(context: any): string {
  const locale = context?.locale === 'id' ? 'id' : 'en';
  const lang = locale === 'id' ? 'Bahasa Indonesia' : 'English';
  const persona = `You are Vayu, Breeva's friendly clean-air assistant for Indonesia.
- ALWAYS reply in ${lang}. Be concise (2–4 sentences), warm, encouraging and eco-positive. Light markdown (**bold**, "- " bullets) only when helpful.
- CRITICAL: you CANNOT do anything by writing text. The ONLY way to actually act is to CALL a tool. Writing "searching…", "let me check…", "okay, finding a route" does NOTHING in the app. So when the user wants an action, call the tool IMMEDIATELY with no narration:
  • go somewhere / get a route / "rute bersih ke X" → call find_clean_route
  • current/real air, or "is it safe to walk now?" / "aman jalan sekarang?" → call check_air_now
  • their pollution exposure / "berapa paparan saya?" → call estimate_exposure
  • change transport mode → call set_transport_mode
  • their EcoPoints / level / streak / stats → call my_stats
  After the tool result comes back, summarize it in one or two friendly sentences.
- For general questions (what is AQI, how Breeva works, tips, cities), just answer from the knowledge base — no tool needed.
- NEVER invent AQI or PM2.5 numbers — only state values from the Live context below or a tool result.
- The cigarette-equivalent is illustrative, not medical. You are not a doctor; for health concerns, suggest a professional.`;

  // Compact live-context block (omit null fields to save tokens)
  const lines: string[] = [];
  const aqi = context?.aqi;
  if (aqi && (aqi.value != null)) {
    lines.push(`- Air now near user: AQI ${aqi.value}${aqi.level ? ` (${aqi.level})` : ''}${aqi.pm25 != null ? `, PM2.5 ${aqi.pm25} µg/m³` : ''}${aqi.area ? `, around ${aqi.area}` : ''}${aqi.freshness ? ` [${aqi.freshness}]` : ''}.`);
  }
  const trip = context?.trip;
  if (trip?.destinationName) {
    const r = trip.selectedRoute;
    lines.push(`- Active trip: to ${trip.destinationName}${trip.transportMode ? ` by ${trip.transportMode}` : ''}${r ? `; selected ${r.label} route AQI ${r.avg_aqi}${r.trap_reduction_pct != null ? `, ${r.trap_reduction_pct}% less traffic exposure` : ''}${r.duration_min != null ? `, ~${r.duration_min} min` : ''}.` : '.'}`);
  }
  const p = context?.profile;
  if (p?.name || p?.level != null) {
    lines.push(`- Signed-in user: ${p.name || 'walker'}${p.level != null ? `, level ${p.level}` : ''}${p.streak != null ? `, ${p.streak}-day streak` : ''}${p.ecopoints != null ? `, ${p.ecopoints} EcoPoints` : ''}${p.total_km != null ? `, ${p.total_km} km walked` : ''}.`);
  } else {
    lines.push(`- User is not signed in (no personal stats available).`);
  }
  const ctx = lines.length ? `\n\nLive context (ground every air-quality claim in this):\n${lines.join('\n')}` : '';

  return `${persona}\n\nAbout Breeva (knowledge base):\n${BREEVA_KB}${ctx}`;
}

// ─── Gemini function-calling tool declarations (≤5, tight) ─────────
const TOOLS = [
  { name: 'check_air_now', description: "Get the current air quality (AQI, PM2.5) at the user's location right now. Use when the user asks if it is safe or clean to walk, or about the current air.", parameters: { type: 'object', properties: {} } },
  { name: 'find_clean_route', description: 'Find and display the cleanest walking route to a destination on the map. Sets the destination and calculates routes. Use when the user wants to go somewhere or asks for a clean/healthy route.', parameters: { type: 'object', properties: { destination: { type: 'string', description: 'The place name or address to navigate to, e.g. "Taman Suropati"' } }, required: ['destination'] } },
  { name: 'estimate_exposure', description: 'Estimate the inhaled PM2.5 dose (in cigarette-equivalents) for the current or selected route. Use when the user asks how much pollution they are exposed to.', parameters: { type: 'object', properties: {} } },
  { name: 'set_transport_mode', description: 'Change the transport mode used for routing.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['walking', 'cycling', 'motorcycle', 'car'] } }, required: ['mode'] } },
  { name: 'my_stats', description: 'Get the signed-in user\'s EcoPoints, level, streak and total distance. Use when the user asks about their progress or stats.', parameters: { type: 'object', properties: {} } },
];

// deno-lint-ignore no-explicit-any
function buildContents(messages: any[], toolResult: any): unknown[] {
  const trimmed = Array.isArray(messages) ? messages.slice(-12) : [];
  const contents: unknown[] = trimmed
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: String(m.content).slice(0, 4000) }] }));
  if (toolResult && toolResult.name) {
    contents.push({ role: 'model', parts: [{ functionCall: { name: toolResult.name, args: toolResult.args ?? {} } }] });
    contents.push({ role: 'user', parts: [{ functionResponse: { name: toolResult.name, response: toolResult.response ?? {} } }] });
  }
  return contents;
}

async function openGeminiStream(body: unknown): Promise<Response | null> {
  const pool = getKeyPool();
  if (pool.length === 0) { console.error('chat: no Gemini keys'); return null; }
  const startIdx = pickStartKeyIdx(pool.length);
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const apiKey = pool[(startIdx + attempt) % pool.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (resp.ok && resp.body) return resp;
      if ([429, 500, 503].includes(resp.status)) { console.warn(`chat: Gemini ${resp.status} key#${attempt} — rotating`); continue; }
      console.error(`chat: Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    } catch (e) { console.error('chat: Gemini fetch failed', e); }
  }
  return null;
}

// Transform Gemini's SSE into our {token|tool_call|error|done} protocol.
function transformStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = '';
  let finish = 'STOP';
  const send = (c: ReadableStreamDefaultController<Uint8Array>, ev: string, data: unknown) =>
    c.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let chunk: unknown;
            try { chunk = JSON.parse(payload); } catch { continue; }
            // deno-lint-ignore no-explicit-any
            const cand = (chunk as any)?.candidates?.[0];
            const parts = cand?.content?.parts ?? [];
            // deno-lint-ignore no-explicit-any
            for (const part of parts as any[]) {
              if (typeof part.text === 'string' && part.text) send(controller, 'token', { t: part.text });
              else if (part.functionCall) send(controller, 'tool_call', { name: part.functionCall.name, args: part.functionCall.args ?? {} });
            }
            if (cand?.finishReason) finish = cand.finishReason;
          }
        }
        send(controller, 'done', { finishReason: finish });
      } catch (e) {
        send(controller, 'error', { message: e instanceof Error ? e.message : String(e) });
        send(controller, 'done', { finishReason: 'ERROR' });
      } finally {
        controller.close();
      }
    },
  });
}

// ─── CORS ──────────────────────────────────────────────────────────
function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && (origin === 'https://breeva.site' || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost'));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'https://breeva.site',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Vary': 'Origin',
  };
}
const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

  // Soft auth: require a bearer token shaped like the public anon/publishable key
  // (format check survives key rotation/format changes). The real protection is
  // that the paid Gemini key never leaves the server + the CORS origin allowlist.
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 40) return json({ error: 'unauthorized' }, 401, cors);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: 'bad json' }, 400, cors); }

  const messages = payload.messages as unknown[];
  const context = payload.context ?? {};
  const toolsEnabled = payload.tools_enabled !== false;
  const toolResult = payload.tool_result ?? null;

  const body = {
    systemInstruction: { parts: [{ text: buildSystemPrompt(context) }] },
    contents: buildContents(messages as never[], toolResult),
    tools: toolsEnabled ? [{ functionDeclarations: TOOLS }] : undefined,
    toolConfig: toolsEnabled ? { functionCallingConfig: { mode: 'AUTO' } } : undefined,
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };

  const upstream = await openGeminiStream(body);
  if (!upstream || !upstream.body) {
    return json({ error: 'AI temporarily unavailable' }, 503, cors);
  }

  return new Response(transformStream(upstream.body), {
    headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
});
