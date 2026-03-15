import { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Leaf, TreePine, Droplets, Wind, Flame, TrendingUp, Award, Footprints } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import BottomNavigation from '../components/layout/BottomNavigation';

const LazyCharts = lazy(() => import('recharts').then(m => ({
  default: ({ data, tab }: { data: WeeklyData[]; tab: 'co2' | 'distance' }) => (
    <m.ResponsiveContainer width="100%" height="100%">
      {tab === 'co2' ? (
        <m.BarChart data={data}>
          <m.XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="#9ca3af" />
          <m.YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={30} />
          <m.Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v) => [`${v} kg`, 'CO₂ Saved']} />
          <m.Bar dataKey="co2" fill="#10b981" radius={[4, 4, 0, 0]} />
        </m.BarChart>
      ) : (
        <m.LineChart data={data}>
          <m.XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="#9ca3af" />
          <m.YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={30} />
          <m.Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v) => [`${v} km`, 'Distance']} />
          <m.Line type="monotone" dataKey="distance" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
        </m.LineChart>
      )}
    </m.ResponsiveContainer>
  )
})));

interface WeeklyData {
  week: string;
  co2: number;
  distance: number;
  walks: number;
}

export default function EcoImpactPage() {
  const navigate = useNavigate();
  const { profile, user } = useAuthStore();
  const [weeklyData, setWeeklyData] = useState<WeeklyData[]>([]);
  const [chartTab, setChartTab] = useState<'co2' | 'distance'>('co2');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 56); // 8 weeks
      const { data: walks } = await supabase
        .from('walks')
        .select('distance_meters, co2_saved_grams, completed_at')
        .eq('user_id', user.id)
        .gte('completed_at', since.toISOString())
        .order('completed_at', { ascending: true });

      if (!walks?.length) return;

      const buckets: Record<string, { co2: number; distance: number; walks: number }> = {};
      for (const w of walks) {
        const d = new Date(w.completed_at);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const key = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
        if (!buckets[key]) buckets[key] = { co2: 0, distance: 0, walks: 0 };
        buckets[key].co2 += (w.co2_saved_grams || 0) / 1000;
        buckets[key].distance += (w.distance_meters || 0) / 1000;
        buckets[key].walks += 1;
      }
      setWeeklyData(Object.entries(buckets).map(([week, v]) => ({
        week,
        co2: Number(v.co2.toFixed(2)),
        distance: Number(v.distance.toFixed(2)),
        walks: v.walks,
      })));
    })();
  }, [user]);

  const totalKm = profile?.total_distance_km || 0;
  const totalWalks = profile?.total_walks || 0;
  const co2Saved = ((profile?.total_co2_saved_grams || 0) / 1000).toFixed(1); // Use server-side value (grams -> kg)
  const treesEquivalent = (Number(co2Saved) / 22).toFixed(2); // 22kg CO2 absorbed per tree/year
  const caloriesBurned = Math.round(totalKm * 60);
  const waterSaved = (totalKm * 3.8).toFixed(0); // ~3.8L water per km of car driving
  const currentStreak = profile?.current_streak || 0;

  const impactCards = [
    {
      icon: Leaf,
      label: 'CO₂ Saved',
      value: `${co2Saved} kg`,
      description: 'vs driving the same distance',
      color: 'from-emerald-400 to-green-500',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    },
    {
      icon: TreePine,
      label: 'Trees Equivalent',
      value: treesEquivalent,
      description: 'trees worth of CO₂ absorbed',
      color: 'from-green-400 to-emerald-600',
      bg: 'bg-green-50 dark:bg-green-900/20',
    },
    {
      icon: Droplets,
      label: 'Water Saved',
      value: `${waterSaved} L`,
      description: 'water not used by cars',
      color: 'from-blue-400 to-cyan-500',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      icon: Wind,
      label: 'Clean Air Impact',
      value: `${(Number(co2Saved) * 0.3).toFixed(0)} g`,
      description: 'particulate matter avoided',
      color: 'from-sky-400 to-blue-500',
      bg: 'bg-sky-50 dark:bg-sky-900/20',
    },
  ];

  const weeklyGoal = 35; // km per week target
  const weeklyProgress = Math.min((totalKm % weeklyGoal) / weeklyGoal * 100, 100);

  const milestones = [
    { distance: 10, label: 'First 10 km', icon: '🌱', unlocked: totalKm >= 10 },
    { distance: 50, label: '50 km Walker', icon: '🚶', unlocked: totalKm >= 50 },
    { distance: 100, label: 'Century Club', icon: '💯', unlocked: totalKm >= 100 },
    { distance: 500, label: 'Eco Warrior', icon: '🌿', unlocked: totalKm >= 500 },
    { distance: 1000, label: '1000 km Legend', icon: '🏆', unlocked: totalKm >= 1000 },
  ];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Eco Impact</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-5">
        {/* Hero stat */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="gradient-primary rounded-2xl p-6 text-center shadow-lg shadow-primary-500/20"
        >
          <Leaf className="w-8 h-8 text-white/80 mx-auto mb-2" />
          <p className="text-white/70 text-xs uppercase tracking-wider mb-1">Your Total Eco Impact</p>
          <h2 className="text-4xl font-bold text-white tabular-nums">{totalKm.toFixed(1)} km</h2>
          <p className="text-white/60 text-xs mt-1">{totalWalks} eco-walks completed</p>

          {/* Streak */}
          <div className="flex items-center justify-center gap-2 mt-3 bg-white dark:bg-gray-900/10 rounded-xl py-2 px-4">
            <Flame className="w-4 h-4 text-amber-300" />
            <span className="text-white text-sm font-medium">{currentStreak} day streak</span>
          </div>
        </motion.div>

        {/* Weekly Progress */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary-500" />
              Weekly Goal
            </h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">{(totalKm % weeklyGoal).toFixed(1)} / {weeklyGoal} km</span>
          </div>
          <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${weeklyProgress}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full gradient-primary rounded-full"
            />
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
            {weeklyProgress >= 100 ? '🎉 Goal achieved! Keep going!' : `${(weeklyGoal - (totalKm % weeklyGoal)).toFixed(1)} km to go`}
          </p>
        </motion.div>

        {/* Impact Grid */}
        <div className="grid grid-cols-2 gap-3">
          {impactCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className="glass-card p-4"
            >
              <div className={`w-9 h-9 rounded-xl ${card.bg} flex items-center justify-center mb-2.5`}>
                <card.icon className="w-4.5 h-4.5 text-primary-600 dark:text-primary-400" />
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{card.value}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">{card.label}</p>
              <p className="text-[9px] text-gray-300 dark:text-gray-600 mt-0.5">{card.description}</p>
            </motion.div>
          ))}
        </div>

        {/* Weekly Charts */}
        {weeklyData.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="glass-card p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary-500" />
                Weekly Trends
              </h3>
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setChartTab('co2')}
                  className={`px-3 py-1 text-[10px] font-medium transition ${chartTab === 'co2' ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400'}`}
                >
                  CO₂
                </button>
                <button
                  onClick={() => setChartTab('distance')}
                  className={`px-3 py-1 text-[10px] font-medium transition ${chartTab === 'distance' ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400'}`}
                >
                  Distance
                </button>
              </div>
            </div>
            <div className="h-44">
              <Suspense fallback={<div className="h-full flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <LazyCharts data={weeklyData} tab={chartTab} />
              </Suspense>
            </div>
          </motion.div>
        )}

        {/* Additional Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card p-4"
        >
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Footprints className="w-4 h-4 text-primary-500" />
            Health Benefits
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{caloriesBurned.toLocaleString()}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Calories Burned</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{Math.round(totalKm * 1312).toLocaleString()}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Approx Steps</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{Math.round(totalKm / 5 * 30)}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Minutes Active</p>
            </div>
          </div>
        </motion.div>

        {/* Milestones */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2 px-1">
            <Award className="w-4 h-4 text-amber-500" />
            Milestones
          </h3>
          <div className="space-y-2">
            {milestones.map((milestone, i) => (
              <motion.div
                key={milestone.distance}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + i * 0.05 }}
                className={`glass-card p-3.5 flex items-center gap-3 ${
                  milestone.unlocked ? '' : 'opacity-50'
                }`}
              >
                <div className="text-2xl">{milestone.icon}</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{milestone.label}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{milestone.distance} km total</p>
                </div>
                {milestone.unlocked ? (
                  <div className="text-primary-500 text-xs font-bold">✓ Unlocked</div>
                ) : (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">
                    {(milestone.distance - totalKm).toFixed(1)} km left
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
