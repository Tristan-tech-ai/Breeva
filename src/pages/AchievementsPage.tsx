import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  requirement_type: string;
  requirement_value: number;
  points_reward: number;
}

interface UserAchievementData {
  achievement_id: string;
  unlocked_at: string;
}

export default function AchievementsPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      setIsLoading(true);

      try {
        // Fetch all achievements
        const { data: allAchievements } = await supabase
          .from('achievements')
          .select('*')
          .order('requirement_value', { ascending: true });

        // Fetch user's unlocked achievements
        const { data: userAchievements } = await supabase
          .from('user_achievements')
          .select('achievement_id, unlocked_at')
          .eq('user_id', user.id);

        if (allAchievements) setAchievements(allAchievements);
        if (userAchievements) {
          setUnlockedIds(new Set(userAchievements.map((ua: UserAchievementData) => ua.achievement_id)));
        }
      } catch (err) {
        console.error('Failed to fetch achievements:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const getProgress = (achievement: Achievement): number => {
    if (!profile) return 0;
    switch (achievement.requirement_type) {
      case 'distance':
        return Math.min(100, ((profile.total_distance_km || 0) / achievement.requirement_value) * 100);
      case 'walks':
        return Math.min(100, ((profile.total_walks || 0) / achievement.requirement_value) * 100);
      case 'streak':
        return Math.min(100, ((profile.longest_streak || 0) / achievement.requirement_value) * 100);
      case 'points':
        return Math.min(100, ((profile.ecopoints_balance || 0) / achievement.requirement_value) * 100);
      default:
        return 0;
    }
  };

  const categoryGroups = achievements.reduce((acc, a) => {
    const cat = a.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(a);
    return acc;
  }, {} as Record<string, Achievement[]>);

  // If no achievements in DB yet, show placeholder
  const placeholderAchievements = [
    { icon: '🥾', name: 'First Steps', desc: 'Complete your first walk', locked: true },
    { icon: '🏃', name: '5K Walker', desc: 'Walk 5 kilometers total', locked: true },
    { icon: '🔥', name: 'Streak Starter', desc: 'Maintain a 3-day streak', locked: true },
    { icon: '🌍', name: 'Eco Warrior', desc: 'Walk 50km total', locked: true },
    { icon: '💎', name: 'Point Collector', desc: 'Earn 1,000 EcoPoints', locked: true },
    { icon: '🏆', name: 'Champion', desc: 'Complete 50 walks', locked: true },
    { icon: '⭐', name: 'Super Streak', desc: 'Maintain a 30-day streak', locked: true },
    { icon: '🌟', name: 'Legend', desc: 'Walk 100km total', locked: true },
  ];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Achievements</h1>
        <div className="w-6" />
      </div>

      <div className="px-4 pt-4 pb-12">
        {/* Summary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 mb-6 text-center"
        >
          <div className="text-3xl font-bold text-primary-500">
            {unlockedIds.size}/{achievements.length || placeholderAchievements.length}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-wider">
            Achievements Unlocked
          </div>
        </motion.div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : achievements.length > 0 ? (
          // Real achievements from database
          Object.entries(categoryGroups).map(([category, items]) => (
            <div key={category} className="mb-6">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">
                {category}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {items.map((achievement, index) => {
                  const unlocked = unlockedIds.has(achievement.id);
                  const progress = getProgress(achievement);
                  return (
                    <motion.div
                      key={achievement.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className={`glass-card p-4 text-center transition-all ${
                        unlocked ? 'glow-primary' : 'opacity-60'
                      }`}
                    >
                      <div className={`text-3xl mb-2 ${unlocked ? '' : 'grayscale'}`}>
                        {achievement.icon || '🏅'}
                      </div>
                      <div className="text-xs font-semibold text-gray-900 dark:text-white mb-1">
                        {achievement.name}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
                        {achievement.description}
                      </div>
                      {unlocked ? (
                        <span className="text-[10px] text-primary-500 font-medium">
                          ✅ +{achievement.points_reward} pts
                        </span>
                      ) : (
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full gradient-primary rounded-full transition-all duration-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          // Placeholder achievements
          <div className="grid grid-cols-2 gap-3">
            {placeholderAchievements.map((achv, index) => (
              <motion.div
                key={achv.name}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                className="glass-card p-4 text-center opacity-60"
              >
                <div className="text-3xl mb-2 grayscale">{achv.icon}</div>
                <div className="text-xs font-semibold text-gray-900 dark:text-white mb-1">
                  {achv.name}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
                  {achv.desc}
                </div>
                <div className="flex items-center justify-center gap-1 text-[10px] text-gray-400">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Locked
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
