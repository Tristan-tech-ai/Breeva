import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  ChevronLeft, Wind, Cigarette, Activity, Info, Save, Check, Sparkles,
  ShieldCheck, ShieldAlert, Clock, Gauge, Waves,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import ProfileForm from '../components/exposure/ProfileForm';
import RouteSelector, { type SelectedRouteData } from '../components/exposure/RouteSelector';
import { useAuthStore } from '../stores/authStore';
import { Seo } from '../components/Seo';
import { saveExposureLedger } from '../lib/exposure-ledger';
import {
  computeDose, doseBreakdown, CIGARETTE_CAVEAT, WHO_24H_PM25,
  type UserExposureProfile, type ExposureDoseResult, type RiskLevel,
} from '../lib/exposure';

// ─── Risk presentation theme — one mapping the whole result section reads from ──
interface RiskTheme { label: string; color: string; Icon: LucideIcon; }
const RISK_THEME: Record<RiskLevel, RiskTheme> = {
  low:       { label: 'Aman',          color: '#22c55e', Icon: ShieldCheck },
  moderate:  { label: 'Sedang',        color: '#eab308', Icon: Info },
  high:      { label: 'Tinggi',        color: '#f97316', Icon: ShieldAlert },
  very_high: { label: 'Sangat tinggi', color: '#ef4444', Icon: ShieldAlert },
};

// Lazy recharts — area chart of µg accumulated along the route (risk-tinted gradient fill).
const LazyDoseChart = lazy(() => import('recharts').then((m) => ({
  default: ({ data, color }: { data: { x: number; ug: number }[]; color: string }) => (
    <m.ResponsiveContainer width="100%" height="100%">
      <m.AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="doseFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.38} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <m.CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.15} vertical={false} />
        <m.XAxis dataKey="x" tick={{ fontSize: 10 }} stroke="#9ca3af" unit="%" tickLine={false} axisLine={false} />
        <m.YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={34} tickLine={false} axisLine={false} />
        <m.Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 10, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.14)' }}
          formatter={(v) => [`${v} µg`, 'Dosis']}
          labelFormatter={(l) => `${l}% rute`}
        />
        <m.Area type="monotone" dataKey="ug" stroke={color} fill="url(#doseFill)" strokeWidth={2.5} />
      </m.AreaChart>
    </m.ResponsiveContainer>
  ),
})));

// ─── Big animated dose gauge — the centerpiece readout ──────────────────────────
function DoseGauge({ result, animate }: { result: ExposureDoseResult; animate: boolean }) {
  const theme = RISK_THEME[result.risk_level];
  const pct = Math.min(result.dose_ug / 2000, 1); // fill toward the "very high" band cap
  const SIZE = 184, R = 70, C = 2 * Math.PI * R;
  return (
    <div className="relative grid place-items-center shrink-0" style={{ width: SIZE, height: SIZE }}>
      {/* soft risk glow behind the dial */}
      <div className="absolute rounded-full blur-2xl" style={{ width: SIZE * 0.7, height: SIZE * 0.7, background: `${theme.color}33` }} />
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth="13"
          className="text-gray-200/80 dark:text-gray-700/60" stroke="currentColor" />
        <motion.circle
          cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth="13" strokeLinecap="round"
          stroke={theme.color} strokeDasharray={C}
          initial={{ strokeDashoffset: animate ? C : C * (1 - pct) }}
          animate={{ strokeDashoffset: C * (1 - pct) }}
          transition={{ duration: animate ? 1.1 : 0, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 5px ${theme.color}88)` }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-[46px] leading-none font-extrabold tabular-nums" style={{ color: theme.color }}>
          {Math.round(result.dose_ug)}
        </div>
        <div className="text-[10.5px] font-medium text-gray-400 dark:text-gray-500 mt-1">µg PM2.5 terhirup</div>
        <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold"
          style={{ color: theme.color, background: `${theme.color}1f` }}>
          <theme.Icon className="w-3 h-3" /> {theme.label}
        </span>
      </div>
    </div>
  );
}

// ─── Cigarette equivalent rendered as real glyphs (full + one clipped fraction) ──
function CigaretteMeter({ equiv }: { equiv: number }) {
  const MAX = 20, ICON = 18;
  const full = Math.min(Math.floor(equiv), MAX);
  const frac = equiv - Math.floor(equiv);
  const showPartial = frac > 0.04 && full < MAX;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 mt-2.5">
      {Array.from({ length: full }).map((_, i) => (
        <Cigarette key={i} className="text-amber-500" style={{ width: ICON, height: ICON }} aria-hidden />
      ))}
      {showPartial && (
        <span className="relative inline-block" style={{ width: ICON, height: ICON }} aria-hidden>
          <Cigarette className="absolute inset-0 text-amber-500/20" style={{ width: ICON, height: ICON }} />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${Math.max(0.1, frac) * 100}%` }}>
            <Cigarette className="text-amber-500" style={{ width: ICON, height: ICON }} />
          </span>
        </span>
      )}
      {equiv < 0.04 && <span className="text-xs text-gray-400 dark:text-gray-500">hampir nol</span>}
    </div>
  );
}

// ─── WHO threshold scale (0–3× of the daily guideline) ──────────────────────────
function WhoScale({ ratio, animate }: { ratio: number; animate: boolean }) {
  const pct = Math.min(ratio / 3, 1) * 100;
  const over = ratio > 1;
  const col = over ? '#f97316' : '#22c55e';
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">vs Ambang WHO</span>
        <span className="font-extrabold tabular-nums" style={{ color: col }}>
          <span className="text-2xl">{ratio.toFixed(1)}</span><span className="text-base">×</span>
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ background: col }}
          initial={{ width: animate ? 0 : `${pct}%` }} animate={{ width: `${pct}%` }}
          transition={{ duration: animate ? 0.9 : 0, ease: [0.22, 1, 0.36, 1], delay: animate ? 0.15 : 0 }} />
        {/* 1× WHO threshold marker (= 1/3 of the 0–3× scale) */}
        <div className="absolute inset-y-0 w-0.5 bg-white dark:bg-gray-950 shadow-sm" style={{ left: '33.33%' }} />
      </div>
      <div className="relative mt-1.5 h-3 text-[9px] text-gray-400 dark:text-gray-500">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 font-semibold text-gray-500 dark:text-gray-400" style={{ left: '33.33%' }}>
          WHO {WHO_24H_PM25}µg
        </span>
        <span className="absolute right-0">3×+</span>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, unit }: { icon: LucideIcon; label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums text-gray-900 dark:text-white truncate">
        {value}<span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 ml-0.5">{unit}</span>
      </div>
    </div>
  );
}

const RECO_ICON: Record<RiskLevel, LucideIcon> = {
  low: ShieldCheck, moderate: Info, high: ShieldAlert, very_high: ShieldAlert,
};

export default function PaparanPage() {
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const [profile, setProfile] = useState<UserExposureProfile>({
    age_bucket: 'adult', mode: 'walk_slow', health_sensitive: false,
  });
  const [selected, setSelected] = useState<SelectedRouteData | null>(null);
  const user = useAuthStore((s) => s.user);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const result = useMemo(
    () => (selected ? computeDose(selected.segments, selected.durationSeconds, profile) : null),
    [selected, profile],
  );

  // Re-arm Save whenever the inputs change (so a new calc isn't shown as already-saved).
  useEffect(() => { setSaveState('idle'); }, [selected, profile]);

  const handleSave = async () => {
    if (!result || !selected) return;
    setSaveState('saving');
    const res = await saveExposureLedger(result, profile, {
      source: 'paparan', label: selected.label,
      durationSeconds: selected.durationSeconds, segmentCount: selected.segments.length,
    });
    setSaveState(res.ok ? 'saved' : 'error');
  };

  const chartData = useMemo(() => {
    if (!selected) return [];
    return doseBreakdown(selected.segments, selected.durationSeconds, profile)
      .map((b) => ({ x: Math.round(b.fraction_along * 100), ug: b.ug }));
  }, [selected, profile]);

  const theme = result ? RISK_THEME[result.risk_level] : null;

  // Staggered reveal for the result cascade (gated by reduced-motion).
  const container: Variants = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.07, delayChildren: reduce ? 0 : 0.04 } } };
  const item: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } } };

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <Seo
        title="Kalkulator Paparan Udara — Breeva"
        description="Hitung dosis PM2.5 yang Anda hirup di sebuah rute: laju napas per usia & aktivitas, perbandingan ambang WHO, dan setara rokok. Berbasis engine AQI per-jalan Breeva."
        path="/paparan"
      />
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
        <button onClick={() => navigate(-1)} aria-label="Kembali"
          className="text-gray-600 dark:text-gray-300 p-1 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Lensa Paparan Udara</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Branded explainer banner */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-emerald-900/10"
          style={{ background: 'linear-gradient(135deg, #047857 0%, #059669 42%, #0ea5e9 100%)' }}
        >
          <div className="absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="absolute -bottom-12 -left-10 w-40 h-40 rounded-full bg-sky-300/20 blur-3xl" aria-hidden />
          <div className="relative">
            <div className="flex items-center gap-1.5 text-white/90">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-[0.18em] font-bold">Layer 3 · Lensa Paparan</span>
            </div>
            <h2 className="mt-2 text-lg font-extrabold leading-snug">Berapa PM2.5 yang benar-benar kamu hirup?</h2>
            <p className="mt-1.5 text-[12.5px] text-white/85 leading-relaxed max-w-md">
              Bukan sekadar AQI rata-rata — kami hitung dosis nyata dari konsentrasi per-jalan (engine v2),
              laju napas (usia & aktivitas), dan perlindungan moda perjalananmu.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {['AQI per-jalan', '× laju napas', '× moda', '× waktu'].map((t) => (
                <span key={t} className="px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-sm text-[10.5px] font-semibold whitespace-nowrap">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </motion.div>

        <ProfileForm profile={profile} onChange={setProfile} />
        <RouteSelector selectedKey={selected?.key ?? null} onSelect={setSelected} />

        {/* Results */}
        {result && selected && theme && (
          <motion.div key={selected.key + profile.mode + profile.age_bucket} variants={container} initial="hidden" animate="show" className="space-y-4">
            {/* Hero: gauge + headline + stat strip, tinted by risk band */}
            <motion.div variants={item} className="glass-card relative overflow-hidden p-5 sm:p-6">
              <div className="absolute inset-0 pointer-events-none" aria-hidden
                style={{ background: `radial-gradient(120% 90% at 50% -10%, ${theme.color}1f 0%, transparent 60%)` }} />
              <div className="relative flex flex-col sm:flex-row items-center gap-5">
                <DoseGauge result={result} animate={!reduce} />
                <div className="w-full min-w-0 space-y-3.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Rute dinilai</p>
                    <p className="text-base font-bold text-gray-900 dark:text-white truncate">{selected.label}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3.5 pt-1">
                    <Stat icon={Clock} label="Durasi" value={result.duration_minutes.toFixed(0)} unit="mnt" />
                    <Stat icon={Wind} label="Rata-rata" value={result.mean_pm25.toFixed(0)} unit="µg/m³" />
                    <Stat icon={Gauge} label="Puncak" value={result.peak_pm25.toFixed(0)} unit="µg/m³" />
                    <Stat icon={Activity} label="Laju napas" value={result.breathing_rate_m3min.toFixed(3)} unit="m³/mnt" />
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 pt-0.5">
                    <Waves className="w-3.5 h-3.5 shrink-0" />
                    Intake efektif {Math.round(result.intake_fraction * 100)}%
                    {result.penetration > 1 && <> · napas {result.penetration.toFixed(1)}× lebih dalam</>}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Cigarette equivalent */}
            <motion.div variants={item} className="glass-card p-4">
              <div className="flex items-baseline gap-1.5">
                <Cigarette className="w-5 h-5 text-amber-500 self-center" />
                <span className="text-2xl font-extrabold text-amber-500 tabular-nums">{result.cigarette_equiv.toFixed(2)}</span>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">batang rokok</span>
              </div>
              <CigaretteMeter equiv={result.cigarette_equiv} />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed mt-2.5">{CIGARETTE_CAVEAT}</p>
            </motion.div>

            {/* WHO comparison */}
            <motion.div variants={item} className="glass-card p-4">
              <WhoScale ratio={result.who_24h_ratio} animate={!reduce} />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3 leading-relaxed">
                Rasio konsentrasi rata-rata rute terhadap ambang harian WHO 2021 ({WHO_24H_PM25} µg/m³).
              </p>
            </motion.div>

            {/* Breakdown chart */}
            {chartData.length > 1 && (
              <motion.div variants={item} className="glass-card p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Dosis sepanjang rute</h3>
                <div className="h-40">
                  <Suspense fallback={<div className="h-full bg-gray-50 dark:bg-gray-800/40 rounded-lg animate-pulse" />}>
                    <LazyDoseChart data={chartData} color={theme.color} />
                  </Suspense>
                </div>
              </motion.div>
            )}

            {/* Recommendation — tinted by risk */}
            <motion.div variants={item} className="rounded-2xl p-4 flex gap-3 border"
              style={{ background: `${theme.color}12`, borderColor: `${theme.color}33` }}>
              {(() => { const Icon = RECO_ICON[result.risk_level]; return <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: theme.color }} />; })()}
              <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed">{result.recommendation}</p>
            </motion.div>

            {/* Save to exposure_ledger (logged-in only; RLS own-rows) */}
            <motion.div variants={item}>
              {user ? (
                <motion.button
                  whileTap={reduce ? undefined : { scale: 0.98 }}
                  onClick={handleSave}
                  disabled={saveState === 'saving' || saveState === 'saved'}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm font-semibold shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 disabled:opacity-70 disabled:shadow-none transition"
                >
                  {saveState === 'saved' ? (<><Check className="w-4 h-4" /> Tersimpan</>)
                    : saveState === 'saving' ? 'Menyimpan…'
                    : saveState === 'error' ? 'Gagal — coba lagi'
                    : (<><Save className="w-4 h-4" /> Simpan paparan</>)}
                </motion.button>
              ) : (
                <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
                  Masuk untuk menyimpan riwayat paparan Anda.
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
