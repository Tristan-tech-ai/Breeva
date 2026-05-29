import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Wind, Cigarette, Activity, Info, Save, Check } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import ProfileForm from '../components/exposure/ProfileForm';
import RouteSelector, { type SelectedRouteData } from '../components/exposure/RouteSelector';
import { useAuthStore } from '../stores/authStore';
import { saveExposureLedger } from '../lib/exposure-ledger';
import {
  computeDose, doseBreakdown, riskColor, CIGARETTE_CAVEAT, WHO_24H_PM25,
  type UserExposureProfile, type ExposureDoseResult,
} from '../lib/exposure';

const RISK_TEXT: Record<ExposureDoseResult['risk_level'], string> = {
  low: 'Aman', moderate: 'Sedang', high: 'Tinggi', very_high: 'Sangat tinggi',
};

// Lazy recharts (same pattern as EcoImpactPage) — area chart of µg accumulated along the route.
const LazyDoseChart = lazy(() => import('recharts').then((m) => ({
  default: ({ data }: { data: { x: number; ug: number }[] }) => (
    <m.ResponsiveContainer width="100%" height="100%">
      <m.AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
        <m.XAxis dataKey="x" tick={{ fontSize: 10 }} stroke="#9ca3af" unit="%" />
        <m.YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={34} />
        <m.Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
          formatter={(v) => [`${v} µg`, 'Dosis']}
          labelFormatter={(l) => `${l}% rute`}
        />
        <m.Area type="monotone" dataKey="ug" stroke="#f97316" fill="#fed7aa" strokeWidth={2} />
      </m.AreaChart>
    </m.ResponsiveContainer>
  ),
})));

function DoseGauge({ result }: { result: ExposureDoseResult }) {
  const color = riskColor(result.risk_level);
  const pct = Math.min(result.dose_ug / 2000, 1); // fill toward the "very high" band cap
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative flex items-center justify-center w-[140px] h-[140px]">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="12"
          className="text-gray-100 dark:text-gray-800" stroke="currentColor" />
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="12" strokeLinecap="round"
          stroke={color} strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
          transform="rotate(-90 70 70)" />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{Math.round(result.dose_ug)}</div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">µg PM2.5 terhirup</div>
        <div className="text-xs font-semibold mt-0.5" style={{ color }}>{RISK_TEXT[result.risk_level]}</div>
      </div>
    </div>
  );
}

export default function PaparanPage() {
  const navigate = useNavigate();
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

  const whoPct = result ? Math.min(result.who_24h_ratio / 3, 1) * 100 : 0; // bar scaled to 3× WHO

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Lensa Paparan Udara</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Intro */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4 flex gap-3"
        >
          <Wind className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            Hitung berapa banyak PM2.5 yang benar-benar Anda hirup pada sebuah rute — dari AQI per-jalan
            engine v2 (Layer 1), rute (Layer 2), laju napas (usia & aktivitas), dan perlindungan moda.
          </p>
        </motion.div>

        <ProfileForm profile={profile} onChange={setProfile} />
        <RouteSelector selectedKey={selected?.key ?? null} onSelect={setSelected} />

        {/* Results */}
        {result && selected && (
          <motion.div
            key={selected.key}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Gauge + headline */}
            <div className="glass-card p-4 flex items-center gap-4">
              <DoseGauge result={result} />
              <div className="flex-1 space-y-1.5">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{selected.label}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {result.duration_minutes.toFixed(0)} menit · rata-rata {result.mean_pm25.toFixed(0)} µg/m³ · puncak {result.peak_pm25.toFixed(0)} µg/m³
                </p>
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <Activity className="w-3 h-3" />
                  napas {result.breathing_rate_m3min.toFixed(3)} m³/mnt · intake {Math.round(result.intake_fraction * 100)}%
                </div>
              </div>
            </div>

            {/* Cigarette equivalent */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Cigarette className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  Setara {result.cigarette_equiv.toFixed(2)} batang rokok
                </span>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">{CIGARETTE_CAVEAT}</p>
            </div>

            {/* WHO comparison */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">vs Ambang WHO</span>
                <span className="text-sm font-bold" style={{ color: result.who_24h_ratio > 1 ? '#f97316' : '#22c55e' }}>
                  {result.who_24h_ratio.toFixed(1)}×
                </span>
              </div>
              <div className="relative h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${whoPct}%`, background: result.who_24h_ratio > 1 ? '#f97316' : '#22c55e' }} />
                {/* WHO threshold marker at 1× (= 1/3 of the 3× scale) */}
                <div className="absolute top-0 bottom-0 w-px bg-gray-400 dark:bg-gray-500" style={{ left: '33.3%' }} />
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
                Rasio konsentrasi rata-rata rute terhadap ambang harian WHO 2021 ({WHO_24H_PM25} µg/m³). Garis = 1× (ambang).
              </p>
            </div>

            {/* Breakdown chart */}
            {chartData.length > 1 && (
              <div className="glass-card p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Dosis sepanjang rute</h3>
                <div className="h-40">
                  <Suspense fallback={<div className="h-full bg-gray-50 dark:bg-gray-800/40 rounded-lg animate-pulse" />}>
                    <LazyDoseChart data={chartData} />
                  </Suspense>
                </div>
              </div>
            )}

            {/* Recommendation */}
            <div className="glass-card p-4 flex gap-3">
              <Info className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
              <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{result.recommendation}</p>
            </div>

            {/* Save to exposure_ledger (logged-in only; RLS own-rows) */}
            {user ? (
              <button
                onClick={handleSave}
                disabled={saveState === 'saving' || saveState === 'saved'}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-primary-500 text-white text-sm font-semibold disabled:opacity-70 transition"
              >
                {saveState === 'saved' ? (<><Check className="w-4 h-4" /> Tersimpan</>)
                  : saveState === 'saving' ? 'Menyimpan…'
                  : saveState === 'error' ? 'Gagal — coba lagi'
                  : (<><Save className="w-4 h-4" /> Simpan paparan</>)}
              </button>
            ) : (
              <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
                Masuk untuk menyimpan riwayat paparan Anda.
              </p>
            )}
          </motion.div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
