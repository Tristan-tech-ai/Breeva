import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Leaf, Footprints, Share2, Trophy, MapPin } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import BottomNavigation from '../components/layout/BottomNavigation';
import AnimatedNumber from '../components/ui/AnimatedNumber';

interface YearStats {
  totalWalks: number;
  totalDistance: number;
  totalPoints: number;
  co2Saved: number;
  avgAqi: number;
  longestStreak: number;
  bestMonth: string;
  bestMonthWalks: number;
  totalContributions: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function YearInReviewPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [stats, setStats] = useState<YearStats | null>(null);
  const [monthlyWalks, setMonthlyWalks] = useState<number[]>(new Array(12).fill(0));
  const [isLoading, setIsLoading] = useState(true);
  const year = new Date().getFullYear();

  useEffect(() => {
    if (!user) return;

    const fetchYearData = async () => {
      setIsLoading(true);
      const startOfYear = `${year}-01-01T00:00:00`;
      const endOfYear = `${year}-12-31T23:59:59`;

      // Walks
      const { data: walks } = await supabase
        .from('walks')
        .select('distance_meters, ecopoints_earned, avg_aqi, created_at')
        .eq('user_id', user.id)
        .gte('created_at', startOfYear)
        .lte('created_at', endOfYear);

      // Contributions
      const { data: contribs } = await supabase
        .from('air_quality_reports')
        .select('id')
        .eq('user_id', user.id)
        .gte('created_at', startOfYear)
        .lte('created_at', endOfYear);

      const walkData = walks || [];
      const monthly = new Array(12).fill(0);
      walkData.forEach(w => {
        const m = new Date(w.created_at).getMonth();
        monthly[m]++;
      });
      setMonthlyWalks(monthly);

      const bestMonthIdx = monthly.indexOf(Math.max(...monthly));

      const totalDistance = walkData.reduce((s, w) => s + ((w.distance_meters || 0) / 1000), 0);
      const totalPoints = walkData.reduce((s, w) => s + (w.ecopoints_earned || 0), 0);
      const aqiReadings = walkData.filter(w => w.avg_aqi != null);
      const avgAqi = aqiReadings.length > 0
        ? Math.round(aqiReadings.reduce((s, w) => s + w.avg_aqi!, 0) / aqiReadings.length)
        : 0;

      setStats({
        totalWalks: walkData.length,
        totalDistance,
        totalPoints,
        co2Saved: totalDistance * 0.17,
        avgAqi,
        longestStreak: profile?.current_streak || 0,
        bestMonth: MONTHS[bestMonthIdx],
        bestMonthWalks: monthly[bestMonthIdx],
        totalContributions: contribs?.length || 0,
      });
      setIsLoading(false);
    };

    fetchYearData();
  }, [user, year, profile?.current_streak]);

  const handleShare = async () => {
    const text = stats
      ? `🌿 My ${year} Breeva Year in Review:\n🚶 ${stats.totalWalks} walks\n📏 ${stats.totalDistance.toFixed(1)} km\n🌱 ${stats.co2Saved.toFixed(1)} kg CO₂ saved\n🏆 ${stats.totalPoints} EcoPoints earned\n\nWalk green with Breeva!`
      : '';
    if (navigator.share) {
      await navigator.share({ title: `Breeva ${year} Year in Review`, text });
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  const maxMonthly = Math.max(1, ...monthlyWalks);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24">
      {/* Header */}
      <div className="relative gradient-primary pb-12 pt-12 px-6">
        <div className="absolute inset-0 bg-white/10 dark:bg-gray-900/20" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button onClick={handleShare} className="text-white/80 hover:text-white">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
          <div className="text-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-5xl mb-2">🌍</div>
              <h1 className="text-2xl font-bold text-white">{year} Year in Review</h1>
              <p className="text-white/70 text-sm mt-1">Your green journey this year</p>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-6 relative z-10 space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            {/* Stats grid skeleton */}
            <div className="grid grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-2xl bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700/30 shadow-sm p-4 animate-pulse">
                  <div className="w-9 h-9 rounded-xl bg-gray-200 dark:bg-gray-700 mb-2" />
                  <div className="w-16 h-6 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="w-12 h-2.5 rounded bg-gray-100 dark:bg-gray-800 mt-1" />
                </div>
              ))}
            </div>
            {/* Monthly chart skeleton */}
            <div className="rounded-2xl bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700/30 shadow-sm p-5 animate-pulse">
              <div className="w-24 h-3 rounded bg-gray-200 dark:bg-gray-700 mb-4" />
              <div className="flex items-end gap-[6px] h-24">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-sm bg-gray-200 dark:bg-gray-700" style={{ height: `${15 + Math.random() * 60}%` }} />
                    <div className="w-2 h-2 rounded bg-gray-100 dark:bg-gray-800" />
                  </div>
                ))}
              </div>
            </div>
            {/* Highlights skeleton */}
            <div className="rounded-2xl bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700/30 shadow-sm p-5 animate-pulse space-y-3">
              <div className="w-20 h-3 rounded bg-gray-200 dark:bg-gray-700" />
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="w-48 h-3.5 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
              ))}
            </div>
            {/* Share button skeleton */}
            <div className="w-full h-12 rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>
        ) : stats && (
          <>
            {/* Main stats grid */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 gap-3"
            >
              {[
                { icon: Footprints, label: 'Total Walks', value: stats.totalWalks, unit: '', color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' },
                { icon: MapPin, label: 'Distance', value: stats.totalDistance, unit: 'km', decimals: 1, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' },
                { icon: Leaf, label: 'CO₂ Saved', value: stats.co2Saved, unit: 'kg', decimals: 1, color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
                { icon: Trophy, label: 'EcoPoints', value: stats.totalPoints, unit: 'pts', color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm p-4"
                >
                  <div className={`w-9 h-9 rounded-xl ${stat.color} flex items-center justify-center mb-2`}>
                    <stat.icon className="w-4 h-4" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <AnimatedNumber value={stat.value} decimals={stat.decimals ?? 0} className="text-xl font-bold tabular-nums text-gray-900 dark:text-white" />
                    {stat.unit && <span className="text-xs text-gray-400">{stat.unit}</span>}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{stat.label}</div>
                </motion.div>
              ))}
            </motion.div>

            {/* Monthly chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm p-5"
            >
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                Monthly Walks
              </h3>
              <div className="flex items-end gap-[6px] h-24">
                {monthlyWalks.map((count, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max((count / maxMonthly) * 100, count > 0 ? 8 : 2)}%` }}
                      transition={{ delay: 0.4 + i * 0.03, duration: 0.5 }}
                      className={`w-full rounded-t-sm ${count > 0 ? 'bg-primary-400 dark:bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                    />
                    <span className="text-[8px] text-gray-400">{MONTHS[i].charAt(0)}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Highlights */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm p-5 space-y-3"
            >
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Highlights
              </h3>
              {[
                { emoji: '📅', text: `Best month: ${stats.bestMonth} with ${stats.bestMonthWalks} walks` },
                { emoji: '🔥', text: `Longest streak: ${stats.longestStreak} days` },
                { emoji: '🌬️', text: `Average AQI during walks: ${stats.avgAqi}` },
                { emoji: '🌍', text: `${stats.totalContributions} air quality contributions` },
                { emoji: '🌳', text: `Equivalent to ${(stats.co2Saved / 22).toFixed(1)} trees planted` },
              ].map((highlight, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.05 }}
                  className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300"
                >
                  <span className="text-lg">{highlight.emoji}</span>
                  <span>{highlight.text}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Share CTA */}
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              onClick={handleShare}
              className="w-full gradient-primary text-white font-semibold py-3 rounded-xl shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              Share Your Year in Review
            </motion.button>
          </>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
