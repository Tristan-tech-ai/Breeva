import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Footprints,
  Sunrise,
  Trophy,
  Wind,
  Flame,
  Calendar,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';

interface Quest {
  id: string;
  title: string;
  description: string;
  icon: string;
  quest_type: string;
  target_value: number;
  reward_points: number;
  is_daily: boolean;
}

interface UserQuest {
  quest_id: string;
  current_value: number;
  is_completed: boolean;
  completed_at: string | null;
}

const iconMap: Record<string, React.ReactNode> = {
  footprints: <Footprints className="w-5 h-5" />,
  sunrise: <Sunrise className="w-5 h-5" />,
  trophy: <Trophy className="w-5 h-5" />,
  wind: <Wind className="w-5 h-5" />,
  fire: <Flame className="w-5 h-5" />,
  calendar: <Calendar className="w-5 h-5" />,
};

export default function QuestsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [userProgress, setUserProgress] = useState<Map<string, UserQuest>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly'>('daily');

  const fetchQuests = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);

    const [{ data: allQuests }, { data: progress }] = await Promise.all([
      supabase.from('quests').select('*').eq('is_active', true).order('reward_points'),
      supabase
        .from('user_quests')
        .select('quest_id, current_value, is_completed, completed_at')
        .eq('user_id', user.id)
        .eq('quest_date', new Date().toISOString().split('T')[0]),
    ]);

    if (allQuests) setQuests(allQuests);
    if (progress) {
      const map = new Map<string, UserQuest>();
      progress.forEach((p) => map.set(p.quest_id, p));
      setUserProgress(map);
    }
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  const dailyQuests = quests.filter((q) => q.is_daily);
  const weeklyQuests = quests.filter((q) => !q.is_daily);
  const displayed = activeTab === 'daily' ? dailyQuests : weeklyQuests;

  const completedCount = displayed.filter((q) => userProgress.get(q.id)?.is_completed).length;

  // Hours until midnight reset
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const hoursLeft = Math.ceil((midnight.getTime() - now.getTime()) / 3600000);

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Quests</h1>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Clock className="w-3.5 h-3.5" />
          {hoursLeft}h
        </div>
      </div>

      <div className="px-4 pt-4 pb-12">
        {/* Summary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 mb-5 text-center"
        >
          <div className="text-3xl font-bold text-primary-500">
            {completedCount}/{displayed.length}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Quests Completed Today</div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {(['daily', 'weekly'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'gradient-primary text-white shadow-md'
                  : 'glass-card text-gray-600 dark:text-gray-400'
              }`}
            >
              {tab === 'daily' ? 'Daily Quests' : 'Weekly Quests'}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
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
        ) : displayed.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No quests available</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map((quest, index) => {
              const progress = userProgress.get(quest.id);
              const pct = progress
                ? Math.min(100, (progress.current_value / quest.target_value) * 100)
                : 0;
              const completed = progress?.is_completed || false;

              return (
                <motion.div
                  key={quest.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`glass-card p-4 ${completed ? 'border border-primary-200 dark:border-primary-800' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        completed
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-500'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                      }`}
                    >
                      {iconMap[quest.icon] || <Trophy className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                          {quest.title}
                        </h3>
                        {completed && <CheckCircle2 className="w-4 h-4 text-primary-500 flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {quest.description}
                      </p>
                      {/* Progress bar */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full gradient-primary rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                          {progress?.current_value || 0}/{quest.target_value}
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
          </div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
