import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cacheCollection, getCachedCollection } from '../lib/offline-db';
import { useAuthStore } from '../stores/authStore';
import { co2KgFromGrams } from '../lib/metrics';
import BottomNavigation from '../components/layout/BottomNavigation';
import { SkeletonGrid } from '../components/ui/Skeleton';
import PageHeader from '../components/ui/PageHeader';
import HeroCard from '../components/ui/HeroCard';
import SectionCard from '../components/ui/SectionCard';
import ProgressBar from '../components/ui/ProgressBar';
import CelebrationBurst from '../components/ui/CelebrationBurst';
import IconBadge from '../components/features/IconBadge';
import { useAchievementUnlocks } from '../components/features/useAchievementUnlocks';

interface ProgressRow {
  achievement_id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  requirement_type: string;
  requirement_value: number;
  points_reward: number;
  is_unlocked: boolean;
  unlocked_at: string | null;
  current_value: number;
  remaining: number;
  progress_pct: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  milestone: 'Tonggak', streak: 'Beruntun', points: 'Poin', eco: 'Lingkungan', distance: 'Jarak',
};

function remainingLabel(r: ProgressRow): string {
  switch (r.requirement_type) {
    case 'total_distance': return `${(r.remaining / 1000).toFixed(1)} km lagi`;
    case 'co2_saved': return `${co2KgFromGrams(r.remaining).toFixed(1)} kg CO₂ lagi`;
    case 'walks': return `${r.remaining} jalan lagi`;
    case 'streak': return `${r.remaining} hari lagi`;
    case 'total_points': return `${r.remaining} poin lagi`;
    default: return `${r.remaining} lagi`;
  }
}

export default function AchievementsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { celebrate } = useAchievementUnlocks();

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_achievement_progress', { p_user_id: user.id });
        if (error) throw error;
        if (alive && data) {
          setRows(data as ProgressRow[]);
          cacheCollection('achievements', (data as ProgressRow[]).map((r) => ({ id: r.achievement_id, ...r }))).catch(() => {});
        }
      } catch {
        const cached = await getCachedCollection<ProgressRow & { id: string }>('achievements');
        if (alive && cached.length) setRows(cached);
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  const unlocked = rows.filter((r) => r.is_unlocked).length;
  const total = rows.length;
  const pct = total ? Math.round((unlocked / total) * 100) : 0;

  const groups = useMemo(() => {
    const g: Record<string, ProgressRow[]> = {};
    for (const r of rows) (g[r.category] ??= []).push(r);
    // within a category: in-progress (by closeness) first, then unlocked.
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => Number(a.is_unlocked) - Number(b.is_unlocked) || b.progress_pct - a.progress_pct);
    }
    return g;
  }, [rows]);

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-16 w-72 h-72 rounded-full bg-primary-400/15 blur-3xl" />
      <CelebrationBurst active={celebrate} />
      <PageHeader title="Pencapaian" onBack={() => navigate(-1)} />

      <div className="relative max-w-2xl mx-auto px-4 pt-4 space-y-5">
        <HeroCard
          eyebrow="Koleksi badge"
          title={`${unlocked} dari ${total || '—'} terbuka`}
          subtitle={`${pct}% selesai`}
          media={<div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center"><Trophy className="w-7 h-7 text-white" /></div>}
        >
          <ProgressBar value={pct} className="bg-white/20" barClassName="bg-white" height={8} />
        </HeroCard>

        {isLoading ? (
          <SkeletonGrid count={6} />
        ) : total === 0 ? (
          <SectionCard><div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Belum ada pencapaian.</div></SectionCard>
        ) : (
          Object.entries(groups).map(([cat, items]) => (
            <SectionCard key={cat} title={CATEGORY_LABEL[cat] ?? cat}>
              <div className="grid grid-cols-1 gap-2.5">
                {items.map((r, i) => (
                  <motion.div
                    key={r.achievement_id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    className={`flex items-center gap-3 rounded-xl p-2.5 ${
                      r.is_unlocked ? 'bg-primary-50/70 dark:bg-primary-900/15' : 'bg-gray-50/70 dark:bg-gray-800/30'
                    }`}
                  >
                    <IconBadge icon={r.icon} category={r.category} unlocked={r.is_unlocked} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{r.name}</span>
                        <span className={`text-[11px] font-extrabold shrink-0 ${r.is_unlocked ? 'text-primary-500' : 'text-gray-400'}`}>+{r.points_reward}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{r.description}</div>
                      {r.is_unlocked ? (
                        <div className="text-[10px] text-primary-600 dark:text-primary-400 font-semibold mt-0.5 flex items-center gap-1">
                          <Trophy className="w-3 h-3" /> Terbuka{r.unlocked_at ? ` · ${new Date(r.unlocked_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}` : ''}
                        </div>
                      ) : (
                        <div className="mt-1.5">
                          <ProgressBar value={r.progress_pct} height={5} />
                          <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> {remainingLabel(r)}</div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </SectionCard>
          ))
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
