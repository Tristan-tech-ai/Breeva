import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Crown, Medal, Award, Footprints, MapPin, Building2,
  Landmark, Globe, Users, LocateFixed, Coins, Route, Sparkles,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';
import { useVirtualizer } from '@tanstack/react-virtual';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Metric = 'points' | 'distance';
type Mode = 'people' | 'regions';
type Scope = 'desa' | 'kabupaten' | 'provinsi' | 'nasional';
type RegionLevel = 'desa' | 'kabupaten' | 'provinsi';

interface UserRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  total_points: number;
  total_distance_meters: number;
  total_walks: number;
  rank: number;
  is_me: boolean;
}
interface RegionRow {
  region_code: string;
  name: string;
  parent_name: string | null;
  member_count: number;
  total_points: number;
  total_distance_meters: number;
  rank: number;
  is_mine: boolean;
}
interface MyRegion {
  region_code: string | null;
  desa_name: string | null;
  kab_code: string | null;
  kab_name: string | null;
  prov_code: string | null;
  prov_name: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const SCOPES: { value: Scope; label: string; Icon: typeof MapPin }[] = [
  { value: 'desa', label: 'Desa', Icon: MapPin },
  { value: 'kabupaten', label: 'Kota', Icon: Building2 },
  { value: 'provinsi', label: 'Provinsi', Icon: Landmark },
  { value: 'nasional', label: 'Nasional', Icon: Globe },
];
const LEVELS: { value: RegionLevel; label: string; Icon: typeof MapPin }[] = [
  { value: 'desa', label: 'Desa', Icon: MapPin },
  { value: 'kabupaten', label: 'Kota', Icon: Building2 },
  { value: 'provinsi', label: 'Provinsi', Icon: Landmark },
];
const SCOPE_NOUN: Record<Scope, string> = {
  desa: 'desamu', kabupaten: 'kotamu', provinsi: 'provinsimu', nasional: 'nasional',
};
const LEVEL_NOUN: Record<RegionLevel, string> = {
  desa: 'antar-desa', kabupaten: 'antar-kota', provinsi: 'antar-provinsi',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.warn(`[leaderboard] ${fn} failed:`, error.message);
    return [];
  }
  return (data ?? []) as T[];
}

/** Smooth count-up for the hero stat. */
function useCountUp(target: number, duration = 750): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    let raf = 0;
    let startTs = 0;
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const t = Math.min(1, (ts - startTs) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/** Deterministic gradient for a region "emblem" (regions have no avatar). */
function regionGradient(code: string): { backgroundImage: string } {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return { backgroundImage: `linear-gradient(135deg, hsl(${h} 68% 56%), hsl(${(h + 38) % 360} 70% 44%))` };
}

const metricRaw = (r: { total_points: number; total_distance_meters: number }, m: Metric) =>
  m === 'points' ? r.total_points : r.total_distance_meters;

function formatMetric(m: Metric, raw: number): string {
  return m === 'points'
    ? Math.round(raw).toLocaleString('id-ID')
    : (raw / 1000).toFixed(1);
}
const metricUnit = (m: Metric) => (m === 'points' ? 'poin' : 'km');

const TIER = [
  { ring: 'ring-amber-400', grad: 'from-amber-300 to-amber-500', glow: 'shadow-[0_0_24px_rgba(245,158,11,0.45)]', Icon: Crown, ic: 'text-amber-400' },
  { ring: 'ring-slate-300', grad: 'from-slate-200 to-slate-400', glow: 'shadow-[0_0_18px_rgba(148,163,184,0.4)]', Icon: Medal, ic: 'text-slate-400' },
  { ring: 'ring-orange-400', grad: 'from-orange-300 to-orange-500', glow: 'shadow-[0_0_18px_rgba(234,88,12,0.4)]', Icon: Award, ic: 'text-orange-500' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Sliding-pill segmented control
// ─────────────────────────────────────────────────────────────────────────────
function Segmented<T extends string>({
  options, value, onChange, idBase, size = 'md',
}: {
  options: { value: T; label: string; Icon?: typeof MapPin }[];
  value: T;
  onChange: (v: T) => void;
  idBase: string;
  size?: 'md' | 'sm';
}) {
  return (
    <div className="relative flex gap-1 p-1 rounded-2xl bg-gray-100/80 dark:bg-gray-800/60 border border-white/40 dark:border-white/5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors ${
              size === 'sm' ? 'py-1.5 text-[11px]' : 'py-2 text-xs'
            } ${active ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            {active && (
              <motion.span
                layoutId={idBase}
                className="absolute inset-0 -z-10 rounded-xl gradient-primary shadow-md"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            {opt.Icon && <opt.Icon className="w-3.5 h-3.5" strokeWidth={2.4} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar / Emblem
// ─────────────────────────────────────────────────────────────────────────────
function Avatar({ url, name, className }: { url: string | null; name: string; className?: string }) {
  return (
    <div className={`overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center ${className ?? ''}`}>
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <span className="font-bold text-gray-500 dark:text-gray-300">{name?.[0]?.toUpperCase() ?? '?'}</span>
      )}
    </div>
  );
}
function Emblem({ code, name, className }: { code: string; name: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center text-white font-extrabold ${className ?? ''}`}
      style={regionGradient(code)}
    >
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Podium (top 3)
// ─────────────────────────────────────────────────────────────────────────────
function Podium({
  rows, mode, metric,
}: {
  rows: (UserRow | RegionRow)[];
  mode: Mode;
  metric: Metric;
}) {
  const top3 = rows.slice(0, 3);
  if (top3.length < 3) return null;
  const order = [1, 0, 2]; // 2nd, 1st, 3rd
  return (
    <div className="flex items-end justify-center gap-2.5 mb-2">
      {order.map((idx, slot) => {
        const r = top3[idx];
        const tier = TIER[idx];
        const isFirst = idx === 0;
        const av = isFirst ? 'w-[72px] h-[72px]' : 'w-14 h-14';
        const ped = isFirst ? 'h-24' : idx === 1 ? 'h-[78px]' : 'h-[60px]';
        const mine = mode === 'people' ? (r as UserRow).is_me : (r as RegionRow).is_mine;
        const name = mode === 'people' ? (r as UserRow).full_name : (r as RegionRow).name;
        const sub = mode === 'people'
          ? `${(r as UserRow).total_walks} jalan`
          : `${(r as RegionRow).member_count} warga`;
        return (
          <motion.div
            key={mode === 'people' ? (r as UserRow).user_id : (r as RegionRow).region_code}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * slot, type: 'spring', stiffness: 260, damping: 22 }}
            className="flex flex-col items-center flex-1 max-w-[110px]"
          >
            <tier.Icon className={`w-5 h-5 mb-1 ${tier.ic}`} fill="currentColor" />
            <div className={`relative rounded-full p-[3px] bg-gradient-to-br ${tier.grad} ${isFirst ? tier.glow : ''}`}>
              {mode === 'people' ? (
                <Avatar url={(r as UserRow).avatar_url} name={name} className={`${av} rounded-full ring-2 ring-white dark:ring-gray-900`} />
              ) : (
                <Emblem code={(r as RegionRow).region_code} name={name} className={`${av} rounded-full ring-2 ring-white dark:ring-gray-900 ${isFirst ? 'text-2xl' : 'text-xl'}`} />
              )}
              <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-gradient-to-br ${tier.grad} text-white text-[11px] font-extrabold flex items-center justify-center ring-2 ring-white dark:ring-gray-900`}>
                {idx + 1}
              </span>
            </div>
            <div className={`mt-2 text-xs font-bold text-center leading-tight truncate max-w-full ${mine ? 'text-primary-600 dark:text-primary-400' : 'text-gray-900 dark:text-white'}`}>
              {name}{mine && ' •'}
            </div>
            <div className="text-[10px] text-gray-400 mb-1.5">{sub}</div>
            <div className={`w-full ${ped} rounded-t-xl bg-gradient-to-b ${tier.grad} opacity-90 flex items-start justify-center pt-2`}>
              <div className="text-white text-center drop-shadow">
                <div className="text-sm font-extrabold leading-none">{formatMetric(metric, metricRaw(r, metric))}</div>
                <div className="text-[9px] font-semibold opacity-90">{metricUnit(metric)}</div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────────────────────────────────────
function RowShell({
  rank, mine, children,
}: { rank: number; mine: boolean; children: React.ReactNode }) {
  return (
    <div className={`glass-card p-2.5 flex items-center gap-3 mb-2 ${mine ? 'ring-2 ring-primary-400/70 dark:ring-primary-500/60' : ''}`}>
      <span className={`w-6 text-center text-sm font-extrabold tabular-nums ${mine ? 'text-primary-500' : 'text-gray-400'}`}>{rank}</span>
      {children}
    </div>
  );
}

function PersonRow({ r, metric }: { r: UserRow; metric: Metric }) {
  return (
    <RowShell rank={r.rank} mine={r.is_me}>
      <Avatar url={r.avatar_url} name={r.full_name} className="w-9 h-9 rounded-full flex-shrink-0 text-xs" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
          {r.full_name} {r.is_me && <span className="text-primary-500 font-bold">(Kamu)</span>}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <Footprints className="w-3 h-3" /> {r.total_walks} jalan
        </div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-extrabold tabular-nums ${metric === 'points' ? 'text-accent-500' : 'text-primary-500'}`}>
          {formatMetric(metric, metricRaw(r, metric))}
        </div>
        <div className="text-[10px] text-gray-400">{metricUnit(metric)}</div>
      </div>
    </RowShell>
  );
}

function RegionRowItem({ r, metric }: { r: RegionRow; metric: Metric }) {
  return (
    <RowShell rank={r.rank} mine={r.is_mine}>
      <Emblem code={r.region_code} name={r.name} className="w-9 h-9 rounded-xl flex-shrink-0 text-sm" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
          {r.name} {r.is_mine && <span className="text-primary-500 font-bold">• wilayahmu</span>}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-400 truncate">
          <Users className="w-3 h-3" /> {r.member_count} warga{r.parent_name ? ` · ${r.parent_name}` : ''}
        </div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-extrabold tabular-nums ${metric === 'points' ? 'text-accent-500' : 'text-primary-500'}`}>
          {formatMetric(metric, metricRaw(r, metric))}
        </div>
        <div className="text-[10px] text-gray-400">{metricUnit(metric)}</div>
      </div>
    </RowShell>
  );
}

/** Virtualized list of people (ranks 4+). */
function PeopleList({ rows, metric }: { rows: UserRow[]; metric: Metric }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 6,
  });
  return (
    <div ref={parentRef} className="max-h-[58vh] overflow-auto scrollbar-hide">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={rows[vi.index].user_id}
            ref={virtualizer.measureElement}
            data-index={vi.index}
            className="absolute left-0 right-0"
            style={{ top: vi.start }}
          >
            <PersonRow r={rows[vi.index]} metric={metric} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const { profile } = useAuthStore();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('people');
  const [scope, setScope] = useState<Scope>('nasional');
  const [level, setLevel] = useState<RegionLevel>('provinsi');
  const [metric, setMetric] = useState<Metric>('points');

  const [people, setPeople] = useState<UserRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [myRegion, setMyRegion] = useState<MyRegion | null>(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const scopeTouched = useRef(false);

  // ── My region (names per level) ───────────────────────────────────────────
  const fetchMyRegion = useCallback(async () => {
    const rows = await rpc<MyRegion>('get_my_region', {});
    const mr = rows[0] ?? null;
    setMyRegion(mr);
    // Default people-scope to the user's city the first time we learn their region.
    if (mr?.region_code && !scopeTouched.current) {
      scopeTouched.current = true;
      setScope('kabupaten');
    }
    return mr;
  }, []);

  // ── Board ─────────────────────────────────────────────────────────────────
  const fetchBoard = useCallback(async () => {
    if (mode === 'people') {
      const rows = await rpc<UserRow>('get_region_leaderboard', { p_scope: scope, p_metric: metric });
      setPeople(rows);
    } else {
      const rows = await rpc<RegionRow>('get_region_standings', { p_level: level, p_metric: metric });
      setRegions(rows);
    }
  }, [mode, scope, level, metric]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      await fetchMyRegion();
      if (alive) { await fetchBoard(); setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchBoard().finally(() => setLoading(false));
  }, [fetchBoard]);

  // ── GPS auto-detect: if region unknown, ask once and resolve it ────────────
  const detectViaGPS = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const code = await rpc<string>('set_my_region_from_point', {
          p_lat: pos.coords.latitude, p_lng: pos.coords.longitude,
        });
        await fetchMyRegion();
        await fetchBoard();
        setLocating(false);
        void code;
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    );
  }, [fetchMyRegion, fetchBoard]);

  useEffect(() => {
    if (myRegion && !myRegion.region_code) detectViaGPS();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRegion?.region_code]);

  // ── Realtime: refetch (debounced) when either board changes ────────────────
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const ch = supabase
      .channel('leaderboard:region')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard_weekly' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'region_leaderboard_weekly' }, bump)
      .subscribe();
    function bump() {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => fetchBoard(), 1200);
    }
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(ch);
    };
  }, [fetchBoard]);

  // ── Derived: hero + breadcrumb ─────────────────────────────────────────────
  const hasRegion = !!myRegion?.region_code;
  const needsRegion = mode === 'people' ? scope !== 'nasional' : true;

  const breadcrumb = useMemo(() => {
    if (!myRegion?.region_code) return [];
    return [myRegion.desa_name, myRegion.kab_name, myRegion.prov_name].filter(Boolean) as string[];
  }, [myRegion]);

  const heroRow = useMemo(() => {
    if (mode === 'people') return people.find((p) => p.is_me) ?? null;
    return regions.find((r) => r.is_mine) ?? null;
  }, [mode, people, regions]);

  const fieldCount = mode === 'people' ? people.length : regions.length;

  const heroRank = heroRow ? (mode === 'people' ? (heroRow as UserRow).rank : (heroRow as RegionRow).rank) : 0;
  const heroValueRaw = heroRow ? metricRaw(heroRow, metric) : 0;
  const heroCount = useCountUp(metric === 'points' ? heroValueRaw : heroValueRaw / 1000);
  const heroDisplay = metric === 'points'
    ? Math.round(heroCount).toLocaleString('id-ID')
    : heroCount.toFixed(1);

  const heroSubtitle = mode === 'people'
    ? `Peringkat di ${SCOPE_NOUN[scope]}`
    : `Wilayahmu • ${LEVEL_NOUN[level]}`;
  const heroTitle = mode === 'regions' && hasRegion
    ? (level === 'provinsi' ? myRegion?.prov_name : level === 'kabupaten' ? myRegion?.kab_name : myRegion?.desa_name) ?? (profile?.full_name || 'Kamu')
    : (profile?.full_name || 'Eco Walker');

  const showGpsCta = needsRegion && !hasRegion;
  const listRows = mode === 'people' ? people : regions;

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24 relative overflow-hidden">
      {/* atmospheric blobs */}
      <div className="pointer-events-none absolute -top-24 -left-16 w-72 h-72 rounded-full bg-primary-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -top-10 -right-20 w-72 h-72 rounded-full bg-accent-400/15 blur-3xl" />

      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1 -ml-1" aria-label="Kembali">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-bold text-gray-900 dark:text-white">Papan Peringkat</h1>
        <div className="flex items-center gap-1 text-[10px] font-semibold text-primary-600 dark:text-primary-400">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-primary-400 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-primary-500" />
          </span>
          Live
        </div>
      </div>

      <div className="relative max-w-2xl mx-auto px-4 pt-4">
        {/* Hero — my standing */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl gradient-primary text-white p-5 mb-5 shadow-lg"
        >
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute -right-2 bottom-2 opacity-20"><Sparkles className="w-16 h-16" /></div>

          <div className="relative flex items-center gap-3">
            {mode === 'regions' && hasRegion ? (
              <Emblem code={myRegion!.region_code!} name={heroTitle} className="w-14 h-14 rounded-2xl ring-2 ring-white/40 text-xl flex-shrink-0" />
            ) : (
              <Avatar url={profile?.avatar_url ?? null} name={profile?.full_name || 'E'} className="w-14 h-14 rounded-2xl ring-2 ring-white/40 flex-shrink-0 text-white" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">{heroSubtitle}</div>
              <div className="text-lg font-extrabold truncate">{heroTitle}</div>
              {breadcrumb.length > 0 ? (
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {breadcrumb.map((b, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium bg-white/15 rounded-full px-2 py-0.5">
                      {i === 0 ? <MapPin className="w-2.5 h-2.5" /> : null}{b}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-white/70 mt-0.5">Lokasi belum terdeteksi</div>
              )}
            </div>
          </div>

          {showGpsCta ? (
            <button
              onClick={detectViaGPS}
              disabled={locating}
              className="relative mt-4 w-full flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 transition rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              <LocateFixed className={`w-4 h-4 ${locating ? 'animate-pulse' : ''}`} />
              {locating ? 'Mendeteksi lokasi…' : 'Aktifkan lokasi untuk peringkat wilayah'}
            </button>
          ) : (
            <div className="relative mt-4 flex items-end justify-between">
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black leading-none tabular-nums">{heroRank > 0 ? `#${heroRank}` : '—'}</span>
                  {fieldCount > 0 && heroRank > 0 && (
                    <span className="text-sm text-white/70 font-semibold">/ {fieldCount}</span>
                  )}
                </div>
                <div className="text-[11px] text-white/70 mt-1">
                  {heroRank > 0 ? 'Peringkatmu pekan ini' : 'Belum masuk peringkat'}
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  {metric === 'points' ? <Coins className="w-5 h-5 text-amber-200" /> : <Route className="w-5 h-5 text-white" />}
                  <span className="text-3xl font-black leading-none tabular-nums">{heroDisplay}</span>
                </div>
                <div className="text-[11px] text-white/70 mt-1">{metric === 'points' ? 'EcoPoin' : 'kilometer'}</div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Controls */}
        <div className="space-y-2.5 mb-4">
          <Segmented<Mode>
            idBase="seg-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'people', label: 'Warga', Icon: Users },
              { value: 'regions', label: 'Adu Wilayah', Icon: Landmark },
            ]}
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {mode === 'people' ? (
                <Segmented<Scope> idBase="seg-scope" value={scope} onChange={(v) => { scopeTouched.current = true; setScope(v); }} options={SCOPES} />
              ) : (
                <Segmented<RegionLevel> idBase="seg-level" value={level} onChange={setLevel} options={LEVELS} />
              )}
            </motion.div>
          </AnimatePresence>
          <Segmented<Metric>
            idBase="seg-metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'points', label: 'EcoPoin', Icon: Coins },
              { value: 'distance', label: 'Jarak', Icon: Route },
            ]}
          />
        </div>

        {/* Board */}
        {loading ? (
          <BoardSkeleton />
        ) : showGpsCta ? (
          <EmptyState
            icon={<LocateFixed className="w-7 h-7 text-primary-500" />}
            title="Wilayahmu belum diketahui"
            desc={`Aktifkan lokasi agar kami bisa menampilkan peringkat ${SCOPE_NOUN[scope]}.`}
          />
        ) : listRows.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-7 h-7 text-primary-500" />}
            title="Belum ada peringkat"
            desc="Mulai berjalan untuk mengisi papan peringkat pekan ini."
          />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Podium rows={listRows} mode={mode} metric={metric} />
            {mode === 'people' ? (
              <PeopleList rows={people.slice(3)} metric={metric} />
            ) : (
              <div>
                {regions.slice(3).map((r) => (
                  <RegionRowItem key={r.region_code} r={r} metric={metric} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty + Skeleton
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="glass-card p-8 flex flex-col items-center text-center gap-2 mt-2">
      <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">{icon}</div>
      <div className="text-sm font-bold text-gray-900 dark:text-white">{title}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 max-w-[240px]">{desc}</div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div>
      <div className="flex items-end justify-center gap-3 mb-4">
        {[60, 84, 48].map((h, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="w-14 h-14 rounded-full skeleton-shimmer" />
            <div className="w-12 h-3 rounded skeleton-shimmer" />
            <div className="w-16 rounded-t-xl skeleton-shimmer" style={{ height: h }} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card p-2.5 flex items-center gap-3">
            <div className="w-6 h-4 rounded skeleton-shimmer" />
            <div className="w-9 h-9 rounded-full skeleton-shimmer" />
            <div className="flex-1 space-y-1.5">
              <div className="w-28 h-3.5 rounded skeleton-shimmer" />
              <div className="w-16 h-2.5 rounded skeleton-shimmer" />
            </div>
            <div className="w-12 h-4 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
