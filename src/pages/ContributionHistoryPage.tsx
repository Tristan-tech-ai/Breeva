import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, MapPinPlus, Store, TreePine, AlertTriangle, Clock, Leaf } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

interface Contribution {
  id: string;
  type: string;
  name: string;
  description: string;
  coordinate: { lat: number; lng: number } | null;
  photoUrl?: string;
  createdAt: string;
}

const typeConfig: Record<string, { icon: typeof MapPinPlus; label: string; color: string }> = {
  missing_place: { icon: MapPinPlus, label: 'Missing Place', color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' },
  eco_merchant: { icon: Store, label: 'Eco Merchant', color: 'text-primary-500 bg-primary-50 dark:bg-primary-900/20' },
  green_space: { icon: TreePine, label: 'Green Space', color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
  hazard: { icon: AlertTriangle, label: 'Air Quality Hazard', color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
};

export default function ContributionHistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load from localStorage (all contributions stored locally)
    const stored = JSON.parse(localStorage.getItem('breeva_contributions') || '[]') as Contribution[];

    // Also fetch AQ reports from Supabase
    if (user) {
      supabase
        .from('air_quality_reports')
        .select('id, description, lat, lng, photo_url, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100)
        .then(({ data }) => {
          const dbContributions: Contribution[] = (data || []).map(r => ({
            id: r.id,
            type: 'hazard',
            name: r.description?.split(' — ')[0] || 'AQ Report',
            description: r.description || '',
            coordinate: r.lat && r.lng ? { lat: r.lat, lng: r.lng } : null,
            photoUrl: r.photo_url || undefined,
            createdAt: r.created_at,
          }));

          // Merge: DB reports + local contributions, deduplicate by id
          const ids = new Set(dbContributions.map(c => c.id));
          const merged = [...dbContributions, ...stored.filter(c => !ids.has(c.id))];
          merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setContributions(merged);
          setIsLoading(false);
        });
    } else {
      setContributions(stored.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setIsLoading(false);
    }
  }, [user]);

  const totalPoints = contributions.length * 25;

  const tiers = [
    { min: 0, label: 'Newcomer', icon: '🌱', color: 'text-gray-500' },
    { min: 5, label: 'Contributor', icon: '🌿', color: 'text-green-500' },
    { min: 15, label: 'Scout', icon: '🗺️', color: 'text-blue-500' },
    { min: 30, label: 'Pathfinder', icon: '🧭', color: 'text-purple-500' },
    { min: 50, label: 'Cartographer', icon: '🏆', color: 'text-amber-500' },
  ];
  const currentTier = [...tiers].reverse().find(t => contributions.length >= t.min) || tiers[0];
  const nextTier = tiers.find(t => t.min > contributions.length);
  const tierProgress = nextTier ? ((contributions.length - currentTier.min) / (nextTier.min - currentTier.min)) * 100 : 100;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="gradient-mesh-bg min-h-screen pb-24">
        <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
          <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="w-36 h-4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="w-6" />
        </div>
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
          {/* Stats card skeleton */}
          <div className="gradient-primary rounded-2xl p-5 animate-pulse flex flex-col items-center gap-2">
            <div className="w-7 h-7 rounded bg-white/20" />
            <div className="w-28 h-2.5 rounded bg-white/20" />
            <div className="w-16 h-8 rounded bg-white/20" />
            <div className="w-24 h-2.5 rounded bg-white/10" />
          </div>
          {/* Tier skeleton */}
          <div className="glass-card p-4 animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="space-y-1">
                <div className="w-20 h-3.5 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="w-16 h-2.5 rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full" />
          </div>
          {/* List skeleton */}
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass-card p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="w-32 h-3.5 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="w-20 h-2.5 rounded bg-gray-100 dark:bg-gray-800" />
                </div>
                <div className="text-right space-y-1">
                  <div className="w-14 h-3.5 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="w-16 h-2.5 rounded bg-gray-100 dark:bg-gray-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Contribution History</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Stats Card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="gradient-primary rounded-2xl p-5 text-center">
          <Leaf className="w-7 h-7 text-white/80 mx-auto mb-1" />
          <p className="text-white/60 text-[10px] uppercase tracking-wider">Total Contributions</p>
          <h2 className="text-3xl font-bold text-white">{contributions.length}</h2>
          <p className="text-white/50 text-xs mt-1">+{totalPoints} EcoPoints earned</p>
        </motion.div>

        {/* Contribution Tier */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{currentTier.icon}</span>
            <div>
              <h3 className={`text-sm font-bold ${currentTier.color}`}>{currentTier.label}</h3>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Contribution Rank</p>
            </div>
          </div>
          {nextTier && (
            <div>
              <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mb-1">
                <span>{contributions.length} contributions</span>
                <span>Next: {nextTier.icon} {nextTier.label} ({nextTier.min})</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full gradient-primary rounded-full transition-all" style={{ width: `${tierProgress}%` }} />
              </div>
            </div>
          )}
          {!nextTier && (
            <p className="text-[10px] text-amber-500 font-medium">Max rank achieved! 🎉</p>
          )}
        </motion.div>

        {/* List */}
        {contributions.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <MapPinPlus className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No contributions yet</p>
            <button onClick={() => navigate('/contribute')} className="gradient-primary text-white text-sm px-5 py-2 rounded-xl font-medium">
              Make First Contribution
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {contributions.map((c, i) => {
              const cfg = typeConfig[c.type] || typeConfig.missing_place;
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="glass-card p-3.5 flex items-center gap-3"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{c.name}</h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{cfg.label}</span>
                      <span className="text-[10px] text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                        <Clock size={9} /> {formatDate(c.createdAt)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-primary-500 font-medium">+25 pts</span>
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
