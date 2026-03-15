import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Footprints } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { formatDistance, formatDuration, formatNumber } from '../lib/utils';
import BottomNavigation from '../components/layout/BottomNavigation';
import { SkeletonList } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

interface Walk {
  id: string;
  distance_km: number;
  duration_minutes: number;
  ecopoints_earned: number;
  avg_aqi: number | null;
  route_type: string | null;
  completed_at: string | null;
  created_at: string;
}

export default function WalkHistoryPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [walks, setWalks] = useState<Walk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const LIMIT = 15;

  const fetchWalks = async (offset = 0, append = false) => {
    if (!user) return;
    setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from('walks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + LIMIT - 1);

      if (error) throw error;

      if (data) {
        setWalks(prev => append ? [...prev, ...data] : data);
        setHasMore(data.length === LIMIT);
      }
    } catch (err) {
      console.error('Failed to fetch walks:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWalks();
  }, [user]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchWalks(nextPage * LIMIT, true);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getRouteTypeLabel = (type: string | null) => {
    switch (type) {
      case 'eco': return { label: '🌿 Eco', color: 'text-primary-500' };
      case 'fast': return { label: '🚀 Fast', color: 'text-secondary-500' };
      case 'balanced': return { label: '⚡ Balanced', color: 'text-accent-500' };
      default: return { label: '🚶 Walk', color: 'text-gray-500 dark:text-gray-400' };
    }
  };

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Walk History</h1>
        <div className="w-6" />
      </div>

      <div className="px-4 pt-4 pb-12">
        {/* Walk Cards */}
        {walks.length === 0 && !isLoading ? (
          <EmptyState
            icon={Footprints}
            title="No walks yet"
            description="Start your first eco-walk to see your history here!"
            actionLabel="Start Walking"
            onAction={() => navigate('/')}
          />
        ) : (
          <motion.div
            className="space-y-3"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
          >
            {walks.map((walk) => {
              const routeType = getRouteTypeLabel(walk.route_type);
              return (
                <motion.div
                  key={walk.id}
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                  className="glass-card p-4 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => navigate(`/profile/history/${walk.id}`)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {formatDate(walk.completed_at || walk.created_at)}
                    </span>
                    <span className={`text-xs font-medium ${routeType.color}`}>
                      {routeType.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatDistance(walk.distance_km * 1000)}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Distance</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatDuration(walk.duration_minutes * 60)}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Duration</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-accent-500">
                        +{formatNumber(walk.ecopoints_earned)}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Points</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {/* Load More */}
            {hasMore && !isLoading && (
              <button
                onClick={loadMore}
                className="glass-button w-full py-3 text-sm font-medium text-primary-500"
              >
                Load More
              </button>
            )}
          </motion.div>
        )}

        {/* Loading */}
        {isLoading && (
          <SkeletonList rows={3} />
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
