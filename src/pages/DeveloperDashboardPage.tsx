import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  ChevronLeft, Copy, Check, AlertTriangle, Activity, KeyRound, Globe,
  ShieldAlert, Loader2, TrendingUp, ServerCog, Wifi, Clock, Download, Gauge,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NoIndex } from '../components/Seo';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';

// ─── Types ───────────────────────────────────────────────────
interface KeyRow { id: string; name: string; prefix: string; tier: 'free' | 'pro' | 'enterprise'; created_at: string; last_used_at: string | null; revoked_at: string | null; }
interface DayPoint { day: string; total: number; errors: number; [k: string]: number | string; }
interface IpRow { ip: string; country: string | null; request_count: number; error_count: number; is_vpn: boolean; is_datacenter: boolean; risk_score: number; asn: string | null; last_seen: string; }
interface FlagRow { id: string; key_id: string | null; ip: string | null; flag_type: string; severity: number; detail: Record<string, unknown>; created_at: string; }

const EP_META: Record<string, { label: string; color: string }> = {
  'road-aqi':    { label: 'Air Quality', color: '#10b981' },
  'route-score': { label: 'Routing',     color: '#0ea5e9' },
  'exposure':    { label: 'Exposure',    color: '#f59e0b' },
};
const TIER_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
// Daily per-key request cap by tier (mirrors the gate's TIER_CAPS; enterprise = unlimited).
const TIER_CAP: Record<string, number | null> = { free: 1000, pro: 50000, enterprise: null };
const RANGES = [{ d: 7, label: '7d' }, { d: 30, label: '30d' }, { d: 90, label: '90d' }];

const FLAG_META: Record<string, { label: string; tone: string }> = {
  vpn:              { label: 'VPN traffic',          tone: 'amber' },
  proxy:            { label: 'Proxy traffic',        tone: 'amber' },
  datacenter:       { label: 'Datacenter IP',        tone: 'gray' },
  tor:              { label: 'Tor exit node',        tone: 'red' },
  multi_account_ip: { label: 'Multiple accounts/IP', tone: 'red' },
  velocity:         { label: 'Rapid key creation',   tone: 'red' },
  geo_mismatch:     { label: 'Location change',      tone: 'gray' },
  per_ip_cap:       { label: 'Per-IP limit hit',     tone: 'amber' },
  high_risk_ip:     { label: 'High-risk IP',         tone: 'red' },
};
const TONE: Record<string, string> = {
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
  red:   'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
  gray:  'bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300',
};

function timeAgo(s: string | null): string {
  if (!s) return 'never';
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function flagAccent(t: string): string { return TONE[FLAG_META[t]?.tone ?? 'gray']; }

// ─── Lazy Recharts (kept off the main bundle, EcoImpactPage pattern) ─────────
type ChartKind = 'area' | 'bars' | 'errline';
const Charts = lazy(() => import('recharts').then((m) => ({
  default: ({ kind, data, keys }: { kind: ChartKind; data: unknown[]; keys?: string[] }) => {
    const tip = { contentStyle: { fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' } };
    if (kind === 'area') {
      return (
        <m.ResponsiveContainer width="100%" height="100%">
          <m.AreaChart data={data} margin={{ top: 5, right: 6, left: -18, bottom: 0 }}>
            <defs>
              {Object.entries(EP_META).map(([k, v]) => (
                <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={v.color} stopOpacity={0.45} />
                  <stop offset="95%" stopColor={v.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <m.CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.18} vertical={false} />
            <m.XAxis dataKey="day" tick={{ fontSize: 9 }} stroke="#9ca3af" interval="preserveStartEnd" minTickGap={24} />
            <m.YAxis tick={{ fontSize: 9 }} stroke="#9ca3af" width={32} allowDecimals={false} />
            <m.Tooltip {...tip} />
            {Object.entries(EP_META).filter(([k]) => !keys || keys.includes(k)).map(([k, v]) => (
              <m.Area key={k} type="monotone" dataKey={k} name={v.label} stackId="1" stroke={v.color} strokeWidth={1.5} fill={`url(#g-${k})`} />
            ))}
          </m.AreaChart>
        </m.ResponsiveContainer>
      );
    }
    if (kind === 'bars') {
      return (
        <m.ResponsiveContainer width="100%" height="100%">
          <m.BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
            <m.XAxis type="number" tick={{ fontSize: 9 }} stroke="#9ca3af" allowDecimals={false} />
            <m.YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" width={72} />
            <m.Tooltip {...tip} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <m.Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => <m.Cell key={i} fill={String((d as { fill: string }).fill)} />)}
            </m.Bar>
          </m.BarChart>
        </m.ResponsiveContainer>
      );
    }
    return (
      <m.ResponsiveContainer width="100%" height="100%">
        <m.LineChart data={data} margin={{ top: 5, right: 6, left: -22, bottom: 0 }}>
          <m.CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.18} vertical={false} />
          <m.XAxis dataKey="day" tick={{ fontSize: 9 }} stroke="#9ca3af" interval="preserveStartEnd" minTickGap={24} />
          <m.YAxis tick={{ fontSize: 9 }} stroke="#9ca3af" width={34} unit="%" />
          <m.Tooltip {...tip} formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Error rate']} />
          <m.Line type="monotone" dataKey="rate" stroke="#ef4444" strokeWidth={2} dot={false} />
        </m.LineChart>
      </m.ResponsiveContainer>
    );
  },
})));

const ChartBox = ({ kind, data, height = 'h-48', keys }: { kind: ChartKind; data: unknown[]; height?: string; keys?: string[] }) => (
  <div className={height}>
    <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>}>
      <Charts kind={kind} data={data} keys={keys} />
    </Suspense>
  </div>
);

const StatCard = ({ icon: Icon, label, value, sub, tone = 'primary' }: { icon: typeof Activity; label: string; value: string; sub?: string; tone?: string }) => {
  const tones: Record<string, string> = {
    primary: 'text-primary-500 bg-primary-50 dark:bg-primary-500/10',
    sky: 'text-sky-500 bg-sky-50 dark:bg-sky-500/10',
    amber: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10',
    red: 'text-red-500 bg-red-50 dark:bg-red-500/10',
    violet: 'text-violet-500 bg-violet-50 dark:bg-violet-500/10',
  };
  return (
    <div className="glass-card p-3.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon className="w-4 h-4" /></div>
      <div className="mt-2.5 text-xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
};

export default function DeveloperDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const freshKey = (location.state as { freshKey?: string } | null)?.freshKey ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(!!freshKey);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [perKey, setPerKey] = useState<Record<string, { req: number; errs: number }>>({});
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [endpointTotals, setEndpointTotals] = useState<{ name: string; value: number; fill: string }[]>([]);
  const [ips, setIps] = useState<IpRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [perKeyToday, setPerKeyToday] = useState<Record<string, number>>({});
  const [rangeDays, setRangeDays] = useState(30);
  const [epFilter, setEpFilter] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setErr(null);
    const since = new Date(Date.now() - rangeDays * 86_400_000).toISOString().slice(0, 10);
    const todayUTC = new Date().toISOString().slice(0, 10);
    const [tsRes, ipRes, flagRes, keysRes, usageRes] = await Promise.all([
      supabase.rpc('dev_usage_timeseries', { p_days: rangeDays }),
      supabase.rpc('dev_ip_summary', { p_days: rangeDays }),
      supabase.rpc('dev_recent_flags', { p_limit: 50 }),
      supabase.from('api_keys').select('id,name,prefix,tier,created_at,last_used_at,revoked_at').order('created_at', { ascending: false }),
      supabase.from('api_key_usage').select('key_id,request_count,error_count,day').gte('day', since),
    ]);
    if (tsRes.error) { setErr(tsRes.error.message); setLoading(false); return; }

    // Time-series → per-day stacked + per-endpoint totals
    const byDay = new Map<string, DayPoint>();
    const epTotals: Record<string, number> = {};
    for (const r of (tsRes.data as { day: string; endpoint: string; request_count: number; error_count: number }[]) ?? []) {
      const d = byDay.get(r.day) ?? { day: r.day, total: 0, errors: 0 };
      const rc = Number(r.request_count) || 0;
      d[r.endpoint] = ((d[r.endpoint] as number) ?? 0) + rc;
      d.total += rc; d.errors += Number(r.error_count) || 0;
      byDay.set(r.day, d);
      epTotals[r.endpoint] = (epTotals[r.endpoint] ?? 0) + rc;
    }
    const sorted = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, day: d.day.slice(5).replace('-', '/') }));
    setSeries(sorted);
    setEndpointTotals(Object.keys(EP_META).filter((k) => epTotals[k]).map((k) => ({ name: EP_META[k].label, value: epTotals[k], fill: EP_META[k].color })));

    setIps((ipRes.data as IpRow[]) ?? []);
    setFlags((flagRes.data as FlagRow[]) ?? []);
    if (!keysRes.error) setKeys((keysRes.data as KeyRow[]) ?? []);

    const pk: Record<string, { req: number; errs: number }> = {};
    const pkToday: Record<string, number> = {};
    for (const r of (usageRes.data as { key_id: string; request_count: number; error_count: number; day: string }[]) ?? []) {
      const a = pk[r.key_id] ?? { req: 0, errs: 0 };
      a.req += r.request_count ?? 0; a.errs += r.error_count ?? 0; pk[r.key_id] = a;
      if (r.day === todayUTC) pkToday[r.key_id] = (pkToday[r.key_id] ?? 0) + (r.request_count ?? 0);
    }
    setPerKey(pk);
    setPerKeyToday(pkToday);
    setLoading(false);
  }, [user, rangeDays]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const copyKey = async () => {
    if (!freshKey) return;
    try { await navigator.clipboard.writeText(freshKey); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* */ }
  };

  // Derived stats
  const todayStr = new Date().toISOString().slice(0, 10).slice(5).replace('-', '/');
  const total30d = series.reduce((s, d) => s + d.total, 0);
  const errors30d = series.reduce((s, d) => s + d.errors, 0);
  const todayReq = series.find((d) => d.day === todayStr)?.total ?? 0;
  const errorRate = total30d > 0 ? (errors30d / total30d) * 100 : 0;
  const activeKeys = keys.filter((k) => !k.revoked_at).length;
  const flaggedIps = ips.filter((i) => i.is_vpn || i.is_datacenter || i.risk_score >= 80).length;
  const errLine = series.map((d) => ({ day: d.day, rate: d.total > 0 ? (d.errors / d.total) * 100 : 0 }));

  // Daily quota resets at 00:00 UTC (the gate keys its counter on the UTC date).
  const msToReset = (() => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now; })();
  const resetIn = `${Math.floor(msToReset / 3_600_000)}h ${Math.floor((msToReset % 3_600_000) / 60_000)}m`;
  const activeKeyList = keys.filter((k) => !k.revoked_at);

  const exportCsv = () => {
    const header = ['day', 'road-aqi', 'route-score', 'exposure', 'total', 'errors'];
    const rows = series.map((d) => [d.day, d['road-aqi'] ?? 0, d['route-score'] ?? 0, d['exposure'] ?? 0, d.total, d.errors]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `breeva-api-usage-${rangeDays}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <NoIndex />
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1"><ChevronLeft className="w-6 h-6" /></button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">API Dashboard</h1>
        <Link to="/developers/keys" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Keys</Link>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/60 text-xs font-semibold">
          <Link to="/developers/keys" className="flex-1 text-center py-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition">Keys</Link>
          <span className="flex-1 text-center py-1.5 rounded-lg bg-white dark:bg-gray-900 shadow-sm text-primary-600 dark:text-primary-400">Dashboard</span>
          <Link to="/developers" className="flex-1 text-center py-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition">Docs</Link>
        </div>

        {/* Fresh key reveal (once, from mint redirect) */}
        {freshKey && showKey && (
          <div className="rounded-2xl border border-green-300 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 p-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Check className="w-4 h-4" /><h3 className="text-sm font-bold">Key created — copy it now</h3>
            </div>
            <p className="text-[11px] text-green-700/80 dark:text-green-400/70 mt-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> This is the only time the full key is shown. Store it somewhere safe.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-gray-900 dark:bg-black/60 px-3 py-2.5">
              <code className="text-[11px] sm:text-xs text-green-300 font-mono break-all flex-1">{freshKey}</code>
              <button onClick={copyKey} className="text-gray-400 hover:text-white transition shrink-0">
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={() => setShowKey(false)} className="mt-3 text-xs font-semibold text-green-700 dark:text-green-400 hover:underline">I've saved it — dismiss</button>
          </div>
        )}

        {loading ? (
          <div className="glass-card p-10 flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : err ? (
          <div className="glass-card p-4 text-xs text-red-500 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {err}</div>
        ) : total30d === 0 && activeKeys === 0 ? (
          <div className="glass-card p-8 text-center">
            <Activity className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">No usage yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create a key and make your first call to see analytics here.</p>
            <Link to="/developers/keys" className="inline-block mt-3 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline">Go to keys →</Link>
          </div>
        ) : (
          <>
            {/* Range filter + export */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/60 text-[11px] font-semibold">
                {RANGES.map((r) => (
                  <button key={r.d} onClick={() => setRangeDays(r.d)}
                    className={`px-3 py-1 rounded-lg transition ${rangeDays === r.d ? 'bg-white dark:bg-gray-900 shadow-sm text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {r.label}
                  </button>
                ))}
              </div>
              <button onClick={exportCsv} disabled={series.length === 0}
                className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 disabled:opacity-40 transition">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            {/* Daily quota — usage vs cap + reset countdown */}
            {activeKeyList.length > 0 && (
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-primary-500" /> Daily quota</h3>
                  <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> resets in {resetIn} · 00:00 UTC</span>
                </div>
                <div className="space-y-3">
                  {activeKeyList.map((k) => {
                    const used = perKeyToday[k.id] ?? 0;
                    const cap = TIER_CAP[k.tier];
                    const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
                    const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-primary-500';
                    return (
                      <div key={k.id}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{k.name} <span className="text-gray-400">· {TIER_LABEL[k.tier]}</span></span>
                          <span className="tabular-nums text-gray-500 dark:text-gray-400">{used.toLocaleString()} / {cap ? cap.toLocaleString() : '∞'}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <div className={`h-full rounded-full ${cap ? barColor : 'bg-primary-300'}`} style={{ width: cap ? `${pct}%` : '100%' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={Activity} label="Requests today" value={todayReq.toLocaleString()} tone="primary" />
              <StatCard icon={TrendingUp} label={`Requests · ${rangeDays}d`} value={total30d.toLocaleString()} tone="sky" />
              <StatCard icon={AlertTriangle} label="Error rate" value={`${errorRate.toFixed(1)}%`} sub={`${errors30d.toLocaleString()} errors`} tone="amber" />
              <StatCard icon={KeyRound} label="Active keys" value={`${activeKeys}`} sub={`of 10`} tone="violet" />
            </div>

            {/* Requests over time */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Requests over time</h3>
                <span className="text-[10px] text-gray-400">last {rangeDays} days</span>
              </div>
              {series.length > 0 ? <ChartBox kind="area" data={series} keys={epFilter ? [epFilter] : undefined} /> : <p className="text-xs text-gray-400 py-8 text-center">No requests in this period.</p>}
              <div className="flex items-center gap-2 mt-2 justify-center flex-wrap">
                {Object.entries(EP_META).map(([k, v]) => {
                  const active = !epFilter || epFilter === k;
                  return (
                    <button key={k} onClick={() => setEpFilter(epFilter === k ? null : k)}
                      className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full transition ${epFilter === k ? 'bg-gray-100 dark:bg-gray-800' : ''} ${active ? 'text-gray-600 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'}`}>
                      <span className="w-2 h-2 rounded-full" style={{ background: v.color, opacity: active ? 1 : 0.4 }} /> {v.label}
                    </button>
                  );
                })}
                {epFilter && <button onClick={() => setEpFilter(null)} className="text-[10px] text-primary-600 dark:text-primary-400 hover:underline">clear</button>}
              </div>
            </div>

            {/* Endpoint breakdown + error rate */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="glass-card p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">By endpoint</h3>
                {endpointTotals.length > 0 ? <ChartBox kind="bars" data={endpointTotals} height="h-40" /> : <p className="text-xs text-gray-400 py-8 text-center">No data.</p>}
              </div>
              <div className="glass-card p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Error rate</h3>
                {errLine.length > 0 ? <ChartBox kind="errline" data={errLine} height="h-40" /> : <p className="text-xs text-gray-400 py-8 text-center">No data.</p>}
              </div>
            </div>

            {/* Per-key table */}
            <section>
              <div className="flex items-center justify-between px-1 mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Keys</h3>
                <Link to="/developers/keys" className="text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:underline">Manage →</Link>
              </div>
              <div className="glass-card divide-y divide-gray-100 dark:divide-gray-800/50">
                {keys.length === 0 ? (
                  <p className="text-xs text-gray-400 p-4 text-center">No keys yet.</p>
                ) : keys.map((k) => {
                  const u = perKey[k.id] ?? { req: 0, errs: 0 };
                  return (
                    <div key={k.id} className={`flex items-center gap-3 p-3 ${k.revoked_at ? 'opacity-50' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">{k.name}</span>
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">{TIER_LABEL[k.tier]}</span>
                          {k.revoked_at && <span className="text-[9px] font-semibold uppercase text-red-500">revoked</span>}
                        </div>
                        <code className="text-[10px] text-gray-400 font-mono">{k.prefix}••••</code>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums">{u.req.toLocaleString()}<span className="text-[10px] font-normal text-gray-400"> req</span></div>
                        <div className="text-[10px] text-gray-400">{timeAgo(k.last_used_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Traffic sources (surfaces the IP intelligence) */}
            <section>
              <div className="flex items-center justify-between px-1 mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Traffic sources</h3>
                <span className="text-[11px] text-gray-400">{ips.length} IP{ips.length === 1 ? '' : 's'}{flaggedIps > 0 && <span className="text-amber-500"> · {flaggedIps} flagged</span>}</span>
              </div>
              {flaggedIps > 0 && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] px-3 py-2 mb-2 flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {flaggedIps} source{flaggedIps === 1 ? '' : 's'} flagged as VPN / datacenter / high-risk. Soft-monitored — not blocked.
                </div>
              )}
              <div className="glass-card divide-y divide-gray-100 dark:divide-gray-800/50">
                {ips.length === 0 ? (
                  <p className="text-xs text-gray-400 p-4 text-center">No traffic recorded yet.</p>
                ) : ips.slice(0, 12).map((ip) => (
                  <div key={ip.ip} className="flex items-center gap-2.5 p-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${ip.is_datacenter ? 'bg-gray-100 dark:bg-gray-700/40 text-gray-500' : 'bg-sky-50 dark:bg-sky-500/10 text-sky-500'}`}>
                      {ip.is_datacenter ? <ServerCog className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <code className="text-[11px] font-mono text-gray-700 dark:text-gray-300">{ip.ip}</code>
                        {ip.country && <span className="text-[9px] text-gray-400">{ip.country}</span>}
                        {ip.is_vpn && <span className="px-1 py-0.5 text-[8px] font-bold rounded bg-amber-100 dark:bg-amber-500/15 text-amber-600">VPN</span>}
                        {ip.is_datacenter && <span className="px-1 py-0.5 text-[8px] font-bold rounded bg-gray-200 dark:bg-gray-700/50 text-gray-500">DC</span>}
                        {ip.risk_score >= 80 && <span className="px-1 py-0.5 text-[8px] font-bold rounded bg-red-100 dark:bg-red-500/15 text-red-500">RISK {ip.risk_score}</span>}
                      </div>
                      {ip.asn && <span className="text-[9px] text-gray-400">{ip.asn}</span>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums">{ip.request_count.toLocaleString()}</div>
                      <div className="text-[9px] text-gray-400">{timeAgo(ip.last_seen)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Notices / anomaly flags */}
            {flags.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white px-1 mb-2 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Security notices</h3>
                <div className="glass-card divide-y divide-gray-100 dark:divide-gray-800/50">
                  {flags.slice(0, 8).map((f) => (
                    <div key={f.id} className="flex items-center gap-2.5 p-3">
                      <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-md shrink-0 ${flagAccent(f.flag_type)}`}>{FLAG_META[f.flag_type]?.label ?? f.flag_type}</span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate flex-1">{f.ip ?? '—'}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(f.created_at)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <BottomNavigation />
    </div>
  );
}
