import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, KeyRound, Plus, Copy, Check, Trash2, ShieldCheck,
  Activity, AlertTriangle, Zap, Terminal, Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NoIndex } from '../components/Seo';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';

// ─── Types ───────────────────────────────────────────────────
interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  tier: 'free' | 'pro' | 'enterprise';
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
interface UsageAgg { requests: number; errors: number; }

const TIERS: Record<ApiKeyRow['tier'], { label: string; limit: string; badge: string }> = {
  free:       { label: 'Free',       limit: '1,000 req / day',  badge: 'bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300' },
  pro:        { label: 'Pro',        limit: '50,000 req / day', badge: 'bg-primary-100 dark:bg-primary-500/15 text-primary-600 dark:text-primary-300' },
  enterprise: { label: 'Enterprise', limit: 'Unlimited',        badge: 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300' },
};

const BASE_URL = 'https://breeva.site/api/v1';

const ENDPOINTS = [
  {
    method: 'GET', path: '/road-aqi',
    desc: 'Per-road calibrated AQI (PM2.5, NO₂) as GeoJSON for a bounding box.',
    example: `curl "${BASE_URL}/road-aqi?south=-6.30&west=106.70&north=-6.10&east=106.90&zoom=13" \\\n  -H "Authorization: Bearer brv_live_…"`,
  },
  {
    method: 'POST', path: '/route-score',
    desc: 'Pollution-aware routing — cleanest / balanced / fastest options with per-route AQI exposure.',
    example: `curl -X POST "${BASE_URL}/route-score" \\\n  -H "Authorization: Bearer brv_live_…" -H "Content-Type: application/json" \\\n  -d '{"start":[-6.20,106.80],"end":[-6.17,106.83],"profile":"foot-walking","alternatives":true}'`,
  },
  {
    method: 'POST', path: '/exposure',
    desc: 'Cumulative PM2.5 dose for a path + transport mode, as cigarette-equivalents.',
    example: `curl -X POST "${BASE_URL}/exposure" \\\n  -H "Authorization: Bearer brv_live_…" -H "Content-Type: application/json" \\\n  -d '{"polyline":[[-6.20,106.80],[-6.19,106.81]],"vehicle_type":"pedestrian","duration_minutes":20}'`,
  },
];

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DevelopersPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [usage, setUsage] = useState<Record<string, UsageAgg>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState<ApiKeyRow['tier']>('free');
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintedKey, setMintedKey] = useState<string | null>(null);

  const [copied, setCopied] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    // Keys (RLS → only the caller's own rows)
    const { data: keyRows, error: keyErr } = await supabase
      .from('api_keys')
      .select('id,name,prefix,tier,created_at,last_used_at,revoked_at')
      .order('created_at', { ascending: false });
    if (keyErr) { setLoadError(keyErr.message); setLoading(false); return; }
    setKeys((keyRows as ApiKeyRow[]) ?? []);

    // Usage over the last 30 days, aggregated per key
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const { data: usageRows } = await supabase
      .from('api_key_usage')
      .select('key_id,request_count,error_count,day')
      .gte('day', since);
    const agg: Record<string, UsageAgg> = {};
    for (const r of (usageRows as { key_id: string; request_count: number; error_count: number }[]) ?? []) {
      const a = agg[r.key_id] ?? { requests: 0, errors: 0 };
      a.requests += r.request_count ?? 0;
      a.errors += r.error_count ?? 0;
      agg[r.key_id] = a;
    }
    setUsage(agg);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch { /* clipboard unavailable */ }
  };

  const handleMint = async () => {
    if (minting) return;
    setMinting(true);
    setMintError(null);
    const { data, error } = await supabase.rpc('mint_api_key', {
      p_name: newName.trim() || 'My API key',
      p_tier: newTier,
    });
    setMinting(false);
    if (error) {
      setMintError(
        error.message.includes('key_limit_reached')
          ? 'You have reached the limit of 10 active keys. Revoke one first.'
          : error.message,
      );
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.api_key) {
      setMintedKey(row.api_key as string);
      setNewName('');
      await load();
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm('Revoke this key? Any client using it will immediately stop working.')) return;
    setRevokingId(id);
    const { error } = await supabase.rpc('revoke_api_key', { p_key_id: id });
    setRevokingId(null);
    if (error) { setLoadError(error.message); return; }
    await load();
  };

  const activeCount = keys.filter((k) => !k.revoked_at).length;

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <NoIndex />
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">API Keys</h1>
        <Link to="/developers" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Overview</Link>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Intro */}
        <div className="glass-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Build with Breeva's air-quality data</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                Calibrated per-road AQI, pollution-aware routing, and exposure dose — the same engine that powers
                breeva.site, available over a simple REST API.
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-gray-900 dark:bg-black/50 px-3 py-2">
            <Terminal className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <code className="text-[11px] text-gray-200 font-mono truncate flex-1">{BASE_URL}</code>
            <button onClick={() => handleCopy(BASE_URL, 'base')} className="text-gray-400 hover:text-white transition shrink-0">
              {copied === 'base' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            Authenticate every request with <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>
          </p>
        </div>

        {/* Minted key — shown once */}
        <AnimatePresence>
          {mintedKey && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-2xl border border-green-300 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 p-4">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <Check className="w-4 h-4" />
                  <h3 className="text-sm font-bold">Key created — copy it now</h3>
                </div>
                <p className="text-[11px] text-green-700/80 dark:text-green-400/70 mt-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  This is the only time the full key is shown. Store it somewhere safe.
                </p>
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-gray-900 dark:bg-black/60 px-3 py-2.5">
                  <code className="text-[11px] sm:text-xs text-green-300 font-mono break-all flex-1">{mintedKey}</code>
                  <button onClick={() => handleCopy(mintedKey, 'minted')} className="text-gray-400 hover:text-white transition shrink-0">
                    {copied === 'minted' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={() => setMintedKey(null)}
                  className="mt-3 text-xs font-semibold text-green-700 dark:text-green-400 hover:underline"
                >
                  I've saved it — dismiss
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mint form */}
        <div className="glass-card p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary-500" /> Create a new key
          </h3>
          <input
            type="text"
            placeholder="Key name (e.g. My app, Staging)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            className="w-full bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none border border-gray-200 dark:border-gray-700/50 focus:border-primary-500 mb-3"
          />
          <div className="flex gap-2 mb-3">
            {(Object.keys(TIERS) as ApiKeyRow['tier'][]).map((t) => (
              <button
                key={t}
                onClick={() => setNewTier(t)}
                className={`flex-1 rounded-xl px-2 py-2 text-xs font-semibold transition border ${
                  newTier === t
                    ? 'gradient-primary text-white border-transparent shadow-sm'
                    : 'bg-white dark:bg-gray-900/60 border-gray-200 dark:border-gray-700/40 text-gray-600 dark:text-gray-400'
                }`}
              >
                <div>{TIERS[t].label}</div>
                <div className={`text-[9px] font-normal mt-0.5 ${newTier === t ? 'text-white/80' : 'text-gray-400'}`}>
                  {TIERS[t].limit}
                </div>
              </button>
            ))}
          </div>
          {mintError && (
            <p className="text-xs text-red-500 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {mintError}
            </p>
          )}
          <button
            onClick={handleMint}
            disabled={minting}
            className="w-full py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {minting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {minting ? 'Generating…' : 'Generate key'}
          </button>
        </div>

        {/* Keys list */}
        <section>
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Your keys</h3>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{activeCount}/10 active</span>
          </div>

          {loading ? (
            <div className="glass-card p-8 flex items-center justify-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="glass-card p-4 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {loadError}
            </div>
          ) : keys.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <KeyRound className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No keys yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Generate one above to start calling the API.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((k) => {
                const u = usage[k.id] ?? { requests: 0, errors: 0 };
                const revoked = !!k.revoked_at;
                return (
                  <div
                    key={k.id}
                    className={`rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border shadow-sm overflow-hidden ${
                      revoked ? 'border-gray-200/60 dark:border-gray-700/20 opacity-60' : 'border-gray-200 dark:border-gray-700/30'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{k.name}</h4>
                            <span className={`shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-md ${TIERS[k.tier].badge}`}>
                              {TIERS[k.tier].label}
                            </span>
                            {revoked && (
                              <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-md bg-red-100 dark:bg-red-500/15 text-red-500">
                                Revoked
                              </span>
                            )}
                          </div>
                          <code className="text-[11px] text-gray-500 dark:text-gray-400 font-mono mt-1 block">
                            {k.prefix}••••••••
                          </code>
                        </div>
                        {!revoked && (
                          <button
                            onClick={() => handleRevoke(k.id)}
                            disabled={revokingId === k.id}
                            className="shrink-0 flex items-center justify-center p-2 rounded-xl text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition disabled:opacity-50"
                            title="Revoke key"
                          >
                            {revokingId === k.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/50 text-[11px] text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <Activity className="w-3.5 h-3.5" />
                          {u.requests.toLocaleString()} req
                          {u.errors > 0 && <span className="text-amber-500">· {u.errors.toLocaleString()} err</span>}
                          <span className="text-gray-400 dark:text-gray-600">/ 30d</span>
                        </span>
                        <span>Last used {timeAgo(k.last_used_at)}</span>
                        <span className="ml-auto">Created {fmtDate(k.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Endpoints reference */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white px-1 mb-2">Endpoints</h3>
          <div className="space-y-3">
            {ENDPOINTS.map((ep) => (
              <div key={ep.path} className="glass-card p-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md ${
                      ep.method === 'GET'
                        ? 'bg-sky-100 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300'
                        : 'bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-300'
                    }`}
                  >
                    {ep.method}
                  </span>
                  <code className="text-xs font-mono font-semibold text-gray-900 dark:text-white">{ep.path}</code>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">{ep.desc}</p>
                <div className="mt-2 relative">
                  <pre className="rounded-xl bg-gray-900 dark:bg-black/60 px-3 py-2.5 overflow-x-auto text-[10px] leading-relaxed text-gray-200 font-mono scrollbar-hide">
                    {ep.example}
                  </pre>
                  <button
                    onClick={() => handleCopy(ep.example.replace(/\\\n\s*/g, ' '), ep.path)}
                    className="absolute top-2 right-2 text-gray-400 hover:text-white transition"
                  >
                    {copied === ep.path ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <a
            href="/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="mt-3 block text-center text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
          >
            View full OpenAPI specification →
          </a>
        </section>
      </div>

      <BottomNavigation />
    </div>
  );
}
