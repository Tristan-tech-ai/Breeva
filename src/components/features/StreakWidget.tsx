import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

export default function StreakWidget() {
  const { profile } = useAuthStore();
  const streak = profile?.current_streak || 0;

  if (streak === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800"
    >
      <Flame className="w-4 h-4 text-orange-500" />
      <span className="text-xs font-bold text-orange-600 dark:text-orange-400">{streak}</span>
      <span className="text-[10px] text-orange-500/70">day streak</span>
    </motion.div>
  );
}
