import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, Wind, Route, Activity, KeyRound, Copy, Check,
  ShieldCheck, Zap, Github, Terminal, ChevronRight, Database, Gauge, Lock,
} from 'lucide-react';
import { Seo } from '../components/Seo';

// ── Breeva Developer API — public marketing + docs landing (dark "developer zone").
// Intentional dark, terminal-forward aesthetic that contrasts the light brand site while
// staying on-brand via emerald + the air-quality data motif. SEO target for "breeva api",
// "breeva api key", "air quality api", "clean route / navigation api".

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const BASE = 'https://breeva.site/api/v1';
const KEYS_PATH = '/developers/keys';

// ── Copy-to-clipboard ───────────────────────────────────────
function CopyBtn({ text, id, copied, setCopied }: { text: string; id: string; copied: string | null; setCopied: (v: string | null) => void }) {
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1600); } catch { /* */ } }}
      className="absolute top-3 right-3 p-1.5 rounded-md text-zinc-500 hover:text-emerald-300 hover:bg-white/5 transition"
      aria-label="Copy code"
    >
      {copied === id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

const PILLARS = [
  { icon: Wind, label: 'AIR QUALITY', title: 'Calibrated per-road AQI', body: 'PM2.5 & NO₂ for individual road segments — not a single city average. The calibrated layer that powers breeva.site.', accent: 'text-emerald-300' },
  { icon: Route, label: 'ROUTING', title: 'Pollution-aware navigation', body: 'Cleanest / balanced / fastest route options, each scored by the air you’d actually breathe along the way.', accent: 'text-lime-300' },
  { icon: Activity, label: 'EXPOSURE', title: 'PM2.5 dose, in cigarettes', body: 'Turn any path + transport mode into inhaled dose and cigarette-equivalents — the metric people feel.', accent: 'text-cyan-300' },
];

const ENDPOINTS = [
  {
    method: 'GET', path: '/road-aqi', accent: 'sky',
    blurb: 'Per-road AQI (PM2.5, NO₂) as GeoJSON for a bounding box.',
    code: `curl "${BASE}/road-aqi?south=-6.30&west=106.70\\
&north=-6.10&east=106.90&zoom=13" \\
  -H "Authorization: Bearer brv_live_…"`,
  },
  {
    method: 'POST', path: '/route-score', accent: 'violet',
    blurb: 'Cleanest / balanced / fastest routes, each scored by AQI exposure.',
    code: `curl -X POST "${BASE}/route-score" \\
  -H "Authorization: Bearer brv_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"start":[-6.20,106.80],"end":[-6.17,106.83],
       "profile":"foot-walking","alternatives":true}'`,
  },
  {
    method: 'POST', path: '/exposure', accent: 'emerald',
    blurb: 'Cumulative PM2.5 dose for a path + mode, in cigarette-equivalents.',
    code: `curl -X POST "${BASE}/exposure" \\
  -H "Authorization: Bearer brv_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"polyline":[[-6.20,106.80],[-6.19,106.81]],
       "vehicle_type":"pedestrian","duration_minutes":20}'`,
  },
];

const TIERS = [
  { name: 'Free', limit: '1,000', unit: 'requests / day', cta: 'Get your key', to: KEYS_PATH, featured: false,
    feats: ['All three endpoints', 'Per-key usage analytics', 'No credit card'] },
  { name: 'Pro', limit: '50,000', unit: 'requests / day', cta: 'Talk to us', to: KEYS_PATH, featured: true,
    feats: ['Everything in Free', 'Higher daily quota', 'Priority support'] },
  { name: 'Enterprise', limit: 'Unlimited', unit: 'custom volume', cta: 'Talk to us', to: KEYS_PATH, featured: false,
    feats: ['Everything in Pro', 'Custom SLAs & data scope', 'Dedicated onboarding'] },
];

const STATS = [
  { v: '1.4M', k: 'road segments scored' },
  { v: '4+', k: 'Indonesian cities' },
  { v: '3', k: 'REST endpoints' },
  { v: 'Free', k: '1,000 calls / day' },
];

const fade = (d = 0) => ({
  initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay: d }, viewport: { once: true, margin: '-60px' },
});

export default function DeveloperLandingPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Dedicated JSON-LD for the API (helps "breeva api" / "breeva api key" queries).
  useEffect(() => {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = 'breeva-dev-jsonld';
    s.text = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebAPI',
      name: 'Breeva Developer API',
      description: 'Calibrated per-road air-quality (AQI), pollution-aware navigation/routing, and PM2.5 exposure as a REST API. Free tier with API key, 1,000 requests/day.',
      url: 'https://breeva.site/developers',
      documentation: 'https://breeva.site/openapi.json',
      termsOfService: 'https://breeva.site/terms',
      provider: { '@type': 'Organization', name: 'Breeva', url: 'https://breeva.site' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free tier — 1,000 requests per day with a Breeva API key' },
    });
    document.head.appendChild(s);
    return () => { document.getElementById('breeva-dev-jsonld')?.remove(); };
  }, []);

  const termLines = [
    { t: 'req', s: '$ ', a: 'curl ', u: `${BASE}/road-aqi?bbox=jakarta \\` },
    { t: 'req2', s: '    ', flag: '-H ', str: '"Authorization: Bearer brv_live_…"' },
    { t: 'gap' },
    { t: 'res', txt: '{' },
    { t: 'res', txt: '  "roads": [' },
    { t: 'res', txt: '    { "osm_way_id":', num: ' 95291269,' },
    { t: 'res', txt: '      "aqi":', num: ' 78,', k2: ' "pm25":', num2: ' 24.6,', k3: ' "no2":', num3: ' 31.2 },' },
    { t: 'res', txt: '    …' },
    { t: 'res', txt: '  ]' },
    { t: 'res', txt: '}' },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070c0b] text-zinc-300 antialiased selection:bg-emerald-400/30">
      <Seo
        title="Breeva API — Air Quality, Routing & Exposure API for Developers"
        description="Breeva Developer API: calibrated per-road air-quality (AQI), pollution-aware navigation/routing, and PM2.5 exposure in one REST API. Get a free API key — 1,000 requests/day. API kualitas udara, navigasi rute bersih & paparan untuk developer."
        path="/developers"
      />
      {/* JetBrains Mono — hoisted by React 19 only when this page renders (kept off other routes). */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" />
      <style>{`
        .jb { font-family: ${MONO}; font-feature-settings: "ss02","calt"; }
        @keyframes drift { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(0,-26px,0); } }
        @keyframes blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        @keyframes sheen { 0% { background-position: -120% 0; } 100% { background-position: 220% 0; } }
        .cursor::after { content:'▋'; color:#34d399; animation: blink 1.1s steps(1) infinite; margin-left:2px; }
        .grid-fade { -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 35%, transparent 75%); mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 35%, transparent 75%); }
      `}</style>

      {/* ── Atmosphere ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="grid-fade absolute inset-0 opacity-[0.5]"
          style={{ backgroundImage: 'linear-gradient(rgba(52,211,153,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(52,211,153,.06) 1px, transparent 1px)', backgroundSize: '52px 52px' }} />
        <div className={`absolute -top-40 left-1/2 -translate-x-1/2 h-[620px] w-[920px] rounded-full blur-[120px] opacity-[0.22] bg-emerald-500 ${reduced ? '' : 'animate-[drift_14s_ease-in-out_infinite]'}`} />
        <div className="absolute top-[40%] -right-32 h-[420px] w-[420px] rounded-full blur-[130px] opacity-[0.10] bg-cyan-400" />
        <div className="absolute bottom-0 -left-24 h-[360px] w-[360px] rounded-full blur-[120px] opacity-[0.08] bg-lime-400" />
        {/* grain */}
        <div className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
      </div>

      {/* ── Nav ── */}
      <header className="relative z-20">
        <nav className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <img src="/favicon.svg" alt="Breeva" className="h-6 w-6" />
            <span className="text-sm font-bold text-white">Breeva</span>
            <span className="jb text-[10px] tracking-widest text-emerald-400/80 border border-emerald-400/20 rounded px-1.5 py-0.5">API</span>
          </Link>
          <div className="hidden sm:flex items-center gap-7 text-[13px] text-zinc-400">
            <a href="#endpoints" className="hover:text-emerald-300 transition">Endpoints</a>
            <a href="#quickstart" className="hover:text-emerald-300 transition">Quickstart</a>
            <a href="#pricing" className="hover:text-emerald-300 transition">Pricing</a>
            <a href="/openapi.json" target="_blank" rel="noreferrer" className="hover:text-emerald-300 transition flex items-center gap-1">Reference <ArrowUpRight className="w-3 h-3" /></a>
          </div>
          <Link to={KEYS_PATH} className="group flex items-center gap-1.5 rounded-full bg-emerald-400 text-emerald-950 text-[13px] font-semibold pl-4 pr-3 py-1.5 hover:bg-emerald-300 transition shadow-[0_0_24px_-4px_rgba(52,211,153,.6)]">
            Get API key <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
          </Link>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 pt-12 sm:pt-20 pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center">
        <motion.div {...fade()}>
          <div className="jb inline-flex items-center gap-2 text-[11px] tracking-widest text-emerald-300/90 mb-6">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>
            STATUS — OPERATIONAL · v1
          </div>
          <h1 className="text-[2.6rem] sm:text-6xl font-extrabold leading-[1.02] tracking-tight text-white">
            The air-quality API<br />
            built for <span className="text-emerald-400">navigation.</span>
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-zinc-400 max-w-xl">
            Calibrated <span className="text-zinc-200">per-road AQI</span>, pollution-aware <span className="text-zinc-200">routing</span>,
            and PM2.5 <span className="text-zinc-200">exposure</span> — the data behind breeva.site, in three REST calls.
            Data Google and AQICN don’t sell.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to={KEYS_PATH} className="group inline-flex items-center gap-2 rounded-full bg-emerald-400 text-emerald-950 font-semibold px-6 py-3 hover:bg-emerald-300 transition shadow-[0_0_32px_-6px_rgba(52,211,153,.7)]">
              <KeyRound className="w-4 h-4" /> Get your API key
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
            </Link>
            <a href="#quickstart" className="inline-flex items-center gap-2 rounded-full border border-white/15 text-zinc-200 font-medium px-6 py-3 hover:border-emerald-400/40 hover:text-white transition">
              <Terminal className="w-4 h-4 text-emerald-400" /> Quickstart
            </a>
          </div>
          <p className="jb mt-6 text-[11px] text-zinc-600">// free tier · 1,000 req/day · no credit card</p>
        </motion.div>

        {/* Terminal */}
        <motion.div {...fade(0.12)} className="relative">
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-400/30 via-transparent to-cyan-400/20 blur-[1px]" />
          <div className="relative rounded-2xl border border-white/10 bg-[#0a0f0e]/90 backdrop-blur-xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 h-10 border-b border-white/[0.06] bg-white/[0.02]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" /><span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
              <span className="jb ml-3 text-[11px] text-zinc-500">breeva — road-aqi</span>
              <span className="jb ml-auto text-[10px] text-emerald-400/70">200 OK · 184ms</span>
            </div>
            <pre className="jb text-[12.5px] leading-[1.7] p-5 overflow-x-auto">
{termLines.map((l, i) => (
  <motion.div key={i}
    initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}
    transition={{ delay: 0.5 + i * 0.12, duration: 0.25 }}
    className={l.t === 'gap' ? 'h-3' : ''}
  >
    {l.t === 'req' && (<><span className="text-emerald-400">{l.s}</span><span className="text-zinc-100">{l.a}</span><span className="text-cyan-300">{l.u}</span></>)}
    {l.t === 'req2' && (<><span>{l.s}</span><span className="text-zinc-500">{l.flag}</span><span className="text-emerald-300/90">{l.str}</span></>)}
    {l.t === 'res' && (
      <span className="text-zinc-400">
        {l.txt}
        {l.num && <span className="text-lime-300">{l.num}</span>}
        {l.k2 && <span className="text-zinc-400">{l.k2}</span>}{l.num2 && <span className="text-lime-300">{l.num2}</span>}
        {l.k3 && <span className="text-zinc-400">{l.k3}</span>}{l.num3 && <span className="text-lime-300">{l.num3}</span>}
      </span>
    )}
    {i === termLines.length - 1 && <span className="cursor" />}
  </motion.div>
))}
            </pre>
          </div>
        </motion.div>
      </section>

      {/* ── Stats strip ── */}
      <section className="relative z-10 border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 grid grid-cols-2 md:grid-cols-4 divide-x divide-white/[0.06]">
          {STATS.map((s) => (
            <div key={s.k} className="px-4 py-7 text-center">
              <div className="jb text-3xl font-bold text-white">{s.v}</div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 mt-1">{s.k}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pillars ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-24">
        <motion.p {...fade()} className="jb text-[11px] tracking-widest text-emerald-400/80">01 / WHAT YOU GET</motion.p>
        <motion.h2 {...fade(0.05)} className="mt-3 text-3xl sm:text-4xl font-bold text-white max-w-2xl tracking-tight">Three signals nobody else exposes.</motion.h2>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {PILLARS.map((p, i) => (
            <motion.div {...fade(i * 0.08)} key={p.title}
              className="group relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 hover:border-emerald-400/30 hover:bg-white/[0.04] transition">
              <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 ${p.accent} ring-1 ring-inset ring-white/10 group-hover:scale-105 transition`}>
                <p.icon className="w-5 h-5" />
              </div>
              <p className="jb mt-5 text-[10px] tracking-widest text-zinc-500">{p.label}</p>
              <h3 className="mt-1 text-lg font-semibold text-white">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Endpoints ── */}
      <section id="endpoints" className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-12 scroll-mt-20">
        <motion.p {...fade()} className="jb text-[11px] tracking-widest text-emerald-400/80">02 / ENDPOINTS</motion.p>
        <motion.h2 {...fade(0.05)} className="mt-3 text-3xl sm:text-4xl font-bold text-white tracking-tight">One base URL. Three calls.</motion.h2>
        <motion.code {...fade(0.1)} className="jb mt-4 inline-block text-sm text-zinc-400 border border-white/10 rounded-lg px-3 py-1.5 bg-white/[0.02]">
          {BASE}
        </motion.code>
        <div className="mt-10 space-y-5">
          {ENDPOINTS.map((e, i) => (
            <motion.div {...fade(i * 0.06)} key={e.path}
              className="grid lg:grid-cols-[0.85fr_1.15fr] gap-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 hover:border-white/15 transition">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className={`jb text-[10px] font-bold px-1.5 py-0.5 rounded ${e.method === 'GET' ? 'bg-sky-400/15 text-sky-300' : 'bg-violet-400/15 text-violet-300'}`}>{e.method}</span>
                  <code className="jb text-[15px] font-semibold text-white">{e.path}</code>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{e.blurb}</p>
              </div>
              <div className="relative rounded-xl border border-white/[0.07] bg-[#06100d]/80 overflow-hidden">
                <CopyBtn text={e.code.replace(/\\\n\s*/g, ' ')} id={e.path} copied={copied} setCopied={setCopied} />
                <pre className="jb text-[11.5px] leading-relaxed text-zinc-300 p-4 pr-10 overflow-x-auto">{e.code}</pre>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Quickstart ── */}
      <section id="quickstart" className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-24 scroll-mt-20">
        <motion.p {...fade()} className="jb text-[11px] tracking-widest text-emerald-400/80">03 / QUICKSTART</motion.p>
        <motion.h2 {...fade(0.05)} className="mt-3 text-3xl sm:text-4xl font-bold text-white tracking-tight">Live in under a minute.</motion.h2>
        <div className="mt-12 grid lg:grid-cols-3 gap-5">
          {[
            { n: '01', icon: KeyRound, t: 'Mint a key', b: <>Open the <Link to={KEYS_PATH} className="text-emerald-300 underline-offset-4 hover:underline">dashboard</Link>, name a key, copy it once. Free tier is instant.</> },
            { n: '02', icon: ShieldCheck, t: 'Authenticate', b: <>Send it on every request as <code className="jb text-emerald-300 text-[12px]">Authorization: Bearer</code> — or the <code className="jb text-emerald-300 text-[12px]">x-api-key</code> header.</> },
            { n: '03', icon: Zap, t: 'Build', b: <>Call any endpoint. Watch <code className="jb text-emerald-300 text-[12px]">X-RateLimit-*</code> headers and your usage in the dashboard.</> },
          ].map((s, i) => (
            <motion.div {...fade(i * 0.08)} key={s.n} className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
              <div className="flex items-center justify-between">
                <s.icon className="w-5 h-5 text-emerald-400" />
                <span className="jb text-2xl font-bold text-white/10">{s.n}</span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.b}</p>
            </motion.div>
          ))}
        </div>

        {/* JS snippet */}
        <motion.div {...fade(0.1)} className="relative mt-6 rounded-2xl border border-white/[0.08] bg-[#06100d]/80 overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-10 border-b border-white/[0.06]">
            <Database className="w-3.5 h-3.5 text-emerald-400" /><span className="jb text-[11px] text-zinc-500">node — exposure.js</span>
          </div>
          <CopyBtn id="js-snippet" copied={copied} setCopied={setCopied}
            text={`const r = await fetch("${BASE}/exposure", {\n  method: "POST",\n  headers: { Authorization: "Bearer " + process.env.BREEVA_KEY, "Content-Type": "application/json" },\n  body: JSON.stringify({ polyline: route, vehicle_type: "pedestrian", duration_minutes: 20 }),\n});\nconst { data } = await r.json();\nconsole.log(data.cigarette_equivalent); // 0.018`} />
          <pre className="jb text-[12px] leading-[1.75] text-zinc-300 p-5 pr-10 overflow-x-auto">
<span className="text-violet-300">const</span> r = <span className="text-violet-300">await</span> <span className="text-sky-300">fetch</span>(<span className="text-emerald-300">"{BASE}/exposure"</span>, {'{'}
  method: <span className="text-emerald-300">"POST"</span>,
  headers: {'{'} Authorization: <span className="text-emerald-300">"Bearer "</span> + process.env.<span className="text-lime-300">BREEVA_KEY</span>, <span className="text-emerald-300">"Content-Type"</span>: <span className="text-emerald-300">"application/json"</span> {'}'},
  body: <span className="text-sky-300">JSON</span>.stringify({'{'} polyline: route, vehicle_type: <span className="text-emerald-300">"pedestrian"</span>, duration_minutes: <span className="text-lime-300">20</span> {'}'}),
{'}'});
<span className="text-violet-300">const</span> {'{'} data {'}'} = <span className="text-violet-300">await</span> r.<span className="text-sky-300">json</span>();
console.<span className="text-sky-300">log</span>(data.cigarette_equivalent); <span className="text-zinc-600">// 0.018</span>
          </pre>
        </motion.div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-12 scroll-mt-20">
        <motion.p {...fade()} className="jb text-[11px] tracking-widest text-emerald-400/80">04 / PRICING</motion.p>
        <motion.h2 {...fade(0.05)} className="mt-3 text-3xl sm:text-4xl font-bold text-white tracking-tight">Start free. Scale by request.</motion.h2>
        <div className="mt-12 grid md:grid-cols-3 gap-5 items-start">
          {TIERS.map((t, i) => (
            <motion.div {...fade(i * 0.08)} key={t.name}
              className={`relative rounded-2xl p-6 ${t.featured ? 'border border-emerald-400/40 bg-emerald-400/[0.04] shadow-[0_0_50px_-20px_rgba(52,211,153,.6)]' : 'border border-white/[0.08] bg-white/[0.02]'}`}>
              {t.featured && <span className="jb absolute -top-2.5 left-6 text-[10px] tracking-widest bg-emerald-400 text-emerald-950 font-bold px-2 py-0.5 rounded">POPULAR</span>}
              <h3 className="text-sm font-semibold tracking-wide text-white uppercase">{t.name}</h3>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="jb text-3xl font-bold text-white">{t.limit}</span>
                <span className="text-xs text-zinc-500">{t.unit}</span>
              </div>
              <ul className="mt-5 space-y-2.5">
                {t.feats.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-zinc-400">
                    <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Link to={t.to} className={`mt-6 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition ${t.featured ? 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300' : 'border border-white/15 text-white hover:border-emerald-400/40'}`}>
                {t.cta} <ChevronRight className="w-4 h-4" />
              </Link>
            </motion.div>
          ))}
        </div>
        <p className="jb mt-5 text-[11px] text-zinc-600 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" /> Quotas reset 00:00 UTC · every response carries X-RateLimit-Limit / Remaining.</p>
      </section>

      {/* ── CTA ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-20">
        <motion.div {...fade()} className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 via-[#0a0f0e] to-[#0a0f0e] p-10 sm:p-14 text-center">
          <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-64 w-[640px] rounded-full bg-emerald-500/20 blur-[100px]" />
          <h2 className="relative text-3xl sm:text-5xl font-extrabold tracking-tight text-white">Build something that breathes.</h2>
          <p className="relative mt-4 text-zinc-400 max-w-lg mx-auto">Grab a free key and ship your first clean-air feature today.</p>
          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to={KEYS_PATH} className="group inline-flex items-center gap-2 rounded-full bg-emerald-400 text-emerald-950 font-semibold px-7 py-3 hover:bg-emerald-300 transition shadow-[0_0_32px_-6px_rgba(52,211,153,.7)]">
              <KeyRound className="w-4 h-4" /> Get your API key <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
            </Link>
            <a href="/openapi.json" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/15 text-zinc-200 font-medium px-7 py-3 hover:border-emerald-400/40 transition">
              API reference <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <img src="/favicon.svg" alt="Breeva" className="h-5 w-5 opacity-80" />
            <span>Breeva API</span>
            <Lock className="w-3 h-3 ml-2 text-zinc-600" /><span className="jb text-[11px]">key-gated · rate-limited</span>
          </div>
          <div className="flex items-center gap-6 text-[13px] text-zinc-500">
            <Link to="/" className="hover:text-emerald-300 transition">← breeva.site</Link>
            <a href="/openapi.json" target="_blank" rel="noreferrer" className="hover:text-emerald-300 transition">OpenAPI</a>
            <Link to="/terms" className="hover:text-emerald-300 transition">Terms</Link>
            <a href="https://github.com/Tristan-tech-ai/Breeva" target="_blank" rel="noreferrer" className="hover:text-emerald-300 transition"><Github className="w-4 h-4" /></a>
          </div>
        </div>
      </footer>
    </div>
  );
}
