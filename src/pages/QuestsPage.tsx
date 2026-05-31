import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Footprints,
  Route,
  Wind,
  Sunrise,
  Leaf,
  MapPin,
  Flame,
  Target,
  CheckCircle2,
  Clock,
  Trophy,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cacheCollection, getCachedCollection } from '../lib/offline-db';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';

// Per-user generated quest row (self-describing — no join to `quests`).
interface GenQuest {
  id: string;
  slot: number;
  title: string;
  description: string;
  icon: string;
  event_type: string;
  target_value: number;
  reward_points: number;
  current_value: number;
  is_completed: boolean;
  completed_at: string | null;
}

const iconMap: Record<string, React.ReactNode> = {
  footprints: <Footprints className="w-5 h-5" />,
  route: <Route className="w-5 h-5" />,
  wind: <Wind className="w-5 h-5" />,
  sunrise: <Sunrise className="w-5 h-5" />,
  leaf: <Leaf className="w-5 h-5" />,
  'map-pin': <MapPin className="w-5 h-5" />,
  flame: <Flame className="w-5 h-5" />,
};

// WIB (Asia/Jakarta, UTC+7) calendar date — must match the server's quest day.
function wibToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const SELECT_COLS =
  'id, slot, title, description, icon, event_type, target_value, reward_points, current_value, is_completed, completed_at';

export default function QuestsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [quests, setQuests] = useState<GenQuest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchQuests = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);

    if (!navigator.onLine) {
      const cached = await getCachedCollection<GenQuest>('quests');
      if (cached.length > 0) setQuests(cached);
      setIsLoading(false);
      return;
    }

    try {
      // Generate today's 3 quests if missing (idempotent, own-user guarded).
      await supabase.rpc('ensure_daily_quests', { p_user_id: user.id });
      const { data } = await supabase
        .from('user_quests')
        .select(SELECT_COLS)
        .eq('user_id', user.id)
        .eq('quest_date', wibToday())
        .not('template_id', 'is', null)
        .is('replaced_at', null)
        .order('slot', { ascending: true })
        .order('completed_at', { ascending: true });
      const rows = (data as GenQuest[]) || [];
      setQuests(rows);
      cacheCollection('quests', rows).catch(() => {});
    } catch (error) {
      console.error('Failed to fetch quests:', error);
      const cached = await getCachedCollection<GenQuest>('quests');
      if (cached.length > 0) setQuests(cached);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  // active = the 3 live quests; completed = everything finished today (incl. replaced-slot history)
  const active = quests.filter((q) => !q.is_completed).sort((a, b) => a.slot - b.slot);
  const completed = quests.filter((q) => q.is_completed);
  const earnedToday = completed.reduce((sum, q) => sum + (q.reward_points || 0), 0);

  // Hours until WIB midnight reset
  const wibNow = new Date(Date.now() + 7 * 3600 * 1000);
  const wibMidnight = new Date(wibNow);
  wibMidnight.setUTCHours(24, 0, 0, 0);
  const hoursLeft = Math.max(1, Math.ceil((wibMidnight.getTime() - wibNow.getTime()) / 3600000));

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1" aria-label="Kembali">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Misi Harian</h1>
        <div className="flex items-center gap-1 text-xs text-gray-400" title="Reset tengah malam WIB">
          <Clock className="w-3.5 h-3.5" />
          {hoursLeft}j
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12">
        {/* Summary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 mb-5 text-center"
        >
          <div className="text-3xl font-bold text-primary-500">{completed.length}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            misi selesai hari ini{earnedToday > 0 ? ` · +${earnedToday} EcoPoints` : ''}
          </div>
        </motion.div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="glass-card p-4 animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="w-32 h-4 rounded bg-gray-200 dark:bg-gray-700" />
                    <div className="w-48 h-3 rounded bg-gray-100 dark:bg-gray-800" />
                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full mt-2" />
                  </div>
                  <div className="w-14 h-5 rounded-full bg-gray-100 dark:bg-gray-800" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Active quests */}
            <div className="space-y-3">
              {active.map((quest, index) => {
                const pct = Math.min(100, Math.round((quest.current_value / quest.target_value) * 100));
                return (
                  <motion.div
                    key={quest.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="glass-card p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-gray-400">
                        {iconMap[quest.icon] || <Target className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                          {quest.title}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{quest.description}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full gradient-primary rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                            {quest.current_value}/{quest.target_value}
                          </span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <span className="text-xs font-bold text-primary-500">+{quest.reward_points}</span>
                        <div className="text-[10px] text-gray-400">pts</div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              {active.length === 0 && (
                <div className="glass-card p-8 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Memuat misi…</p>
                </div>
              )}
            </div>

            {/* Completed today */}
            {completed.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mt-6 mb-2 px-1">
                  Selesai hari ini
                </div>
                <div className="space-y-2">
                  {completed.map((quest) => (
                    <div
                      key={quest.id}
                      className="glass-card p-3 opacity-70 border border-primary-200 dark:border-primary-800/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary-100 dark:bg-primary-900/30 text-primary-500">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate line-through decoration-1">
                            {quest.title}
                          </h3>
                        </div>
                        <span className="text-xs font-bold text-primary-500">+{quest.reward_points}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Achievements link */}
            <button
              onClick={() => navigate('/profile/achievements')}
              className="w-full glass-card p-4 mt-6 flex items-center gap-3 active:scale-[0.99] transition-transform"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100 dark:bg-amber-900/30 text-amber-500">
                <Trophy className="w-5 h-5" />
              </div>
              <div className="flex-1 text-left">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pencapaian</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Lencana jangka panjang &amp; milestone</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
