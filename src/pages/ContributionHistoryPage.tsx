import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  ChevronLeft, MapPinPlus, Store, TreePine, Wind, Clock, Coins,
  ShieldCheck, ShieldAlert, Send, Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { submitContribution } from '../lib/api';

type Kind = 'aqi' | 'missing_place' | 'eco_merchant' | 'green_space';
type Status = 'pending' | 'approved' | 'rejected';

interface HistItem {
  id: string;
  kind: Kind;
  title: string;
  status: Status;
  createdAt: string;
  severity?: number;
}

interface AqrRow { id: string; description: string | null; aqi_rating: number | null; status: string | null; created_at: string }
interface PlaceRow { id: string; type: string; name: string; status: string | null; created_at: string }
interface LegacyContribution { type?: string; name?: string; description?: string; category?: string; coordinate?: { lat: number; lng: number } | null }

const TYPE_CFG: Record<Kind, { icon: LucideIcon; label: string; color: string }> = {
  aqi: { icon: Wind, label: 'Laporan udara', color: '#f59e0b' },
  missing_place: { icon: MapPinPlus, label: 'Tempat baru', color: '#3b82f6' },
  eco_merchant: { icon: Store, label: 'Merchant eco', color: '#10b981' },
  green_space: { icon: TreePine, label: 'Ruang hijau', color: '#16a34a' },
};

const STATUS_CFG: Record<Status, { label: string; color: string; Icon: LucideIcon }> = {
  approved: { label: 'Terverifikasi', color: '#22c55e', Icon: ShieldCheck },
  pending: { label: 'Menunggu', color: '#f59e0b', Icon: Clock },
  rejected: { label: 'Ditinjau', color: '#ef4444', Icon: ShieldAlert },
};

const SEVERITY_COLOR = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444'];

const TIERS = [
  { min: 0, label: 'Pemula', icon: '🌱' },
  { min: 5, label: 'Kontributor', icon: '🌿' },
  { min: 15, label: 'Penjelajah', icon: '🗺️' },
  { min: 30, label: 'Perintis', icon: '🧭' },
  { min: 50, label: 'Kartografer', icon: '🏆' },
];

const fmtDate = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

export default function ContributionHistoryPage() {
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<HistItem[]>([]);
  const [count, setCount] = useState(0);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [legacy, setLegacy] = useState<number>(0);
  const [migrating, setMigrating] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const [aqr, place, countRow, ptx] = await Promise.all([
      supabase.from('air_quality_reports').select('id, description, aqi_rating, status, created_at')
        .eq('user_id', user.id).neq('source', 'calibration').order('created_at', { ascending: false }).limit(100),
      supabase.from('place_contributions').select('id, type, name, status, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('users').select('contribution_count').eq('id', user.id).single(),
      supabase.from('points_transactions').select('amount').eq('user_id', user.id).eq('transaction_type', 'contribution'),
    ]);

    const aqiItems: HistItem[] = ((aqr.data || []) as AqrRow[]).map((r) => ({
      id: r.id, kind: 'aqi',
      title: (r.description?.split(' — ')[0]) || 'Laporan kualitas udara',
      status: (r.status as Status) || 'pending', createdAt: r.created_at, severity: r.aqi_rating ?? undefined,
    }));
    const placeItems: HistItem[] = ((place.data || []) as PlaceRow[]).map((r) => ({
      id: r.id, kind: (r.type as Kind), title: r.name, status: (r.status as Status) || 'pending', createdAt: r.created_at,
    }));
    const merged = [...aqiItems, ...placeItems].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    setItems(merged);
    setCount(countRow.data?.contribution_count ?? merged.length);
    setPoints(((ptx.data || []) as { amount: number | null }[]).reduce((s, r) => s + (r.amount || 0), 0));
    setLoading(false);

    // Legacy localStorage contributions awaiting migration to the user's account.
    try {
      if (!localStorage.getItem('breeva_contributions_migrated')) {
        const stored = JSON.parse(localStorage.getItem('breeva_contributions') || '[]');
        if (Array.isArray(stored) && stored.length > 0) setLegacy(stored.length);
      }
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const migrateLegacy = async () => {
    if (!user || migrating) return;
    setMigrating(true);
    localStorage.setItem('breeva_contributions_migrated', '1'); // guard against re-runs first
    try {
      const stored = JSON.parse(localStorage.getItem('breeva_contributions') || '[]') as LegacyContribution[];
      for (const c of stored) {
        const coord = c.coordinate || null;
        const t = c.type;
        if (t === 'hazard') {
          if (!coord) continue;
          await submitContribution({ type: 'hazard', user_id: user.id, lat: coord.lat, lng: coord.lng, aqi_rating: 4, description: c.description || c.name });
        } else if (t === 'missing_place' || t === 'eco_merchant' || t === 'green_space') {
          if (!c.name) continue;
          await submitContribution({ type: t, user_id: user.id, name: c.name, category: c.category || undefined, description: c.description || undefined, ...(coord ? { lat: coord.lat, lng: coord.lng } : {}) });
        }
      }
      localStorage.removeItem('breeva_contributions');
    } catch { /* best-effort */ } finally {
      setLegacy(0);
      setMigrating(false);
      useAuthStore.getState().fetchProfile?.();
      void load();
    }
  };

  const tier = [...TIERS].reverse().find((t) => count >= t.min) || TIERS[0];
  const nextTier = TIERS.find((t) => t.min > count);
  const progress = nextTier ? ((count - tier.min) / (nextTier.min - tier.min)) * 100 : 100;

  const container: Variants = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.05, delayChildren: reduce ? 0 : 0.03 } } };
  const itemV: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } } };

  if (loading) {
    return (
      <div className="gradient-mesh-bg min-h-screen pb-24">
        <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-2"><div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /><div className="w-40 h-4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></div>
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
          <div className="glass-card p-5 h-28 animate-pulse" />
          <div className="glass-card p-4 h-20 animate-pulse" />
          {[...Array(4)].map((_, i) => <div key={i} className="glass-card p-3.5 h-16 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
        <button onClick={() => navigate(-1)} aria-label="Kembali" className="text-gray-600 dark:text-gray-300 p-1 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition"><ChevronLeft className="w-6 h-6" /></button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Riwayat Kontribusi</h1>
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Hero stats */}
        <motion.div variants={itemV} className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-emerald-900/10" style={{ background: 'linear-gradient(135deg,#047857 0%,#059669 45%,#0ea5e9 100%)' }}>
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="relative flex items-end justify-between">
            <div>
              <p className="text-white/70 text-[10px] uppercase tracking-wider">Total kontribusi</p>
              <h2 className="text-4xl font-extrabold tabular-nums leading-none mt-1">{count}</h2>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-[10px] uppercase tracking-wider">EcoPoints</p>
              <p className="text-xl font-bold tabular-nums inline-flex items-center gap-1"><Coins className="w-4 h-4" />{points}</p>
            </div>
          </div>
        </motion.div>

        {/* Legacy migration banner */}
        {legacy > 0 && (
          <motion.div variants={itemV} className="glass-card p-4 flex items-center gap-3 border border-amber-300/40 bg-amber-500/5">
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{legacy} kontribusi lama di perangkat ini</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Kirim ke akunmu agar tersimpan permanen & dihitung.</p>
            </div>
            <button onClick={migrateLegacy} disabled={migrating} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold disabled:opacity-60">
              {migrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Kirim
            </button>
          </motion.div>
        )}

        {/* Tier */}
        <motion.div variants={itemV} className="glass-card p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{tier.icon}</span>
            <div><h3 className="text-sm font-bold text-gray-900 dark:text-white">{tier.label}</h3><p className="text-[10px] text-gray-400 dark:text-gray-500">Peringkat kontributor</p></div>
          </div>
          {nextTier ? (
            <>
              <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mb-1">
                <span>{count} kontribusi</span><span>Berikutnya: {nextTier.icon} {nextTier.label} ({nextTier.min})</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600" initial={{ width: reduce ? `${progress}%` : 0 }} animate={{ width: `${progress}%` }} transition={{ duration: reduce ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            </>
          ) : <p className="text-[10px] text-amber-500 font-medium">Peringkat tertinggi tercapai! 🎉</p>}
        </motion.div>

        {/* List */}
        {items.length === 0 ? (
          <motion.div variants={itemV} className="glass-card p-10 text-center">
            <MapPinPlus className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Belum ada kontribusi</p>
            <button onClick={() => navigate('/contribute')} className="bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm px-5 py-2 rounded-xl font-medium">Buat kontribusi pertama</button>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {items.map((c) => {
              const cfg = TYPE_CFG[c.kind];
              const st = STATUS_CFG[c.status];
              return (
                <motion.div key={c.id} variants={itemV} className="glass-card p-3.5 flex items-center gap-3">
                  <div className="grid place-items-center w-10 h-10 rounded-xl shrink-0 relative" style={{ background: `${cfg.color}1f` }}>
                    <cfg.icon className="w-5 h-5" style={{ color: cfg.color }} />
                    {c.kind === 'aqi' && c.severity && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900" style={{ background: SEVERITY_COLOR[c.severity - 1] }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{c.title}</h4>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                      <span>{cfg.label}</span><span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="flex items-center gap-0.5"><Clock size={9} /> {fmtDate(c.createdAt)}</span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold shrink-0" style={{ color: st.color, background: `${st.color}1a` }}>
                    <st.Icon className="w-3 h-3" /> {st.label}
                  </span>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      <BottomNavigation />
    </div>
  );
}
