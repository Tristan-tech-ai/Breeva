import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Footprints, Leaf, MapPin, Clock, Coins } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { formatDistance, formatDuration, formatNumber } from '../lib/utils';
import { co2KgFromGrams } from '../lib/metrics';
import { cacheCollection, getCachedCollection } from '../lib/offline-db';
import BottomNavigation from '../components/layout/BottomNavigation';
import { SkeletonList } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import PageHeader from '../components/ui/PageHeader';
import HeroCard from '../components/ui/HeroCard';
import Segmented from '../components/ui/Segmented';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import PullToRefreshIndicator from '../components/ui/PullToRefreshIndicator';

interface Walk {
  id: string;
  distance_meters: number;
  duration_seconds: number;
  ecopoints_earned: number;
  co2_saved_grams: number | null;
  avg_aqi: number | null;
  route_type: string | null;
  completed_at: string | null;
  created_at: string;
}
type GroupBy = 'all' | 'week' | 'month';

const ROUTE_LABEL: Record<string, { label: string; dot: string }> = {
  eco: { label: 'Bersih', dot: 'bg-primary-500' },
  fast: { label: 'Cepat', dot: 'bg-secondary-500' },
  balanced: { label: 'Seimbang', dot: 'bg-accent-500' },
};

function Cell({ Icon, value, label, accent }: { Icon: LucideIcon; value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col items-center">
      <Icon className={`w-3.5 h-3.5 mb-1 ${accent}`} />
      <div className="text-xs font-bold text-gray-900 dark:text-white tabular-nums">{value}</div>
      <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function WalkHistoryPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [walks, setWalks] = useState<Walk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [groupBy, setGroupBy] = useState<GroupBy>('all');
  const LIMIT = 15;

  const fetchWalks = async (offset = 0, append = false) => {
    if (!user) return;
    setIsLoading(true);
    try {
      if (!navigator.onLine) {
        const offlineWalks = await getCachedCollection<Walk>('walks');
        if (offlineWalks.length > 0) {
          setWalks((prev) => (append ? [...prev, ...offlineWalks] : offlineWalks));
          setHasMore(false);
          return;
        }
      }
      const { data, error } = await supabase
        .from('walks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + LIMIT - 1);
      if (error) throw error;
      if (data) {
        setWalks((prev) => (append ? [...prev, ...data] : data));
        setHasMore(data.length === LIMIT);
        if (!append) cacheCollection('walks', data).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to fetch walks:', err);
      const offlineWalks = await getCachedCollection<Walk>('walks');
      if (offlineWalks.length > 0) {
        setWalks((prev) => (append ? [...prev, ...offlineWalks] : offlineWalks));
        setHasMore(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchWalks(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchWalks(nextPage * LIMIT, true);
  };

  const handleRefresh = useCallback(async () => {
    setPage(0);
    await fetchWalks(0, false);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const { containerRef, isRefreshing, pullDistance, progress } = usePullToRefresh({ onRefresh: handleRefresh });

  const formatDate = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  const getGroupKey = (s: string) => {
    const d = new Date(s);
    if (groupBy === 'month') return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    if (groupBy === 'week') {
      const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
      const fmt = (dt: Date) => dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      return `${fmt(weekStart)} – ${fmt(weekEnd)}`;
    }
    return '';
  };

  const grouped = groupBy === 'all'
    ? { '': walks }
    : walks.reduce((acc, w) => {
        const key = getGroupKey(w.completed_at || w.created_at);
        (acc[key] ??= []).push(w);
        return acc;
      }, {} as Record<string, Walk[]>);

  return (
    <div ref={containerRef} className="gradient-mesh-bg min-h-screen pb-24 overflow-auto relative">
      <div className="pointer-events-none absolute -top-24 -left-16 w-72 h-72 rounded-full bg-primary-400/15 blur-3xl" />
      <PageHeader title="Riwayat Jalan" onBack={() => navigate(-1)} />

      <div className="relative max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} progress={progress} />

        <HeroCard
          eyebrow="Total perjalanan"
          title={`${profile?.total_walks ?? 0} jalan`}
          subtitle={`${(profile?.total_distance_km ?? 0).toFixed(1)} km · ${co2KgFromGrams(profile?.total_co2_saved_grams ?? 0).toFixed(1)} kg CO₂`}
          media={<div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center"><Footprints className="w-7 h-7 text-white" /></div>}
        />

        <Segmented<GroupBy>
          idBase="wh-group"
          value={groupBy}
          onChange={setGroupBy}
          options={[{ value: 'all', label: 'Semua' }, { value: 'week', label: 'Mingguan' }, { value: 'month', label: 'Bulanan' }]}
        />

        {walks.length === 0 && !isLoading ? (
          <EmptyState
            icon={Footprints}
            title="Belum ada jalan"
            description="Mulai eco-walk pertamamu untuk melihat riwayat di sini!"
            actionLabel="Mulai Jalan"
            onAction={() => navigate('/home')}
          />
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([groupLabel, groupWalks]) => (
              <div key={groupLabel || 'all'}>
                {groupLabel && (
                  <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-1">{groupLabel}</h3>
                )}
                <motion.div
                  className="space-y-2.5"
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                >
                  {groupWalks.map((walk) => {
                    const rt = ROUTE_LABEL[walk.route_type ?? ''];
                    return (
                      <motion.div
                        key={walk.id}
                        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                        className="glass-card p-3.5 cursor-pointer glass-card-hover transition-all"
                        onClick={() => navigate(`/profile/history/${walk.id}`)}
                      >
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(walk.completed_at || walk.created_at)}</span>
                          {rt && (
                            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${rt.dot}`} />{rt.label}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <Cell Icon={MapPin} accent="text-emerald-500" value={formatDistance(walk.distance_meters)} label="Jarak" />
                          <Cell Icon={Clock} accent="text-blue-500" value={formatDuration(walk.duration_seconds)} label="Durasi" />
                          <Cell Icon={Leaf} accent="text-green-500" value={`${co2KgFromGrams(walk.co2_saved_grams ?? 0).toFixed(1)}kg`} label="CO₂" />
                          <Cell Icon={Coins} accent="text-amber-500" value={`+${formatNumber(walk.ecopoints_earned)}`} label="Poin" />
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </div>
            ))}

            {hasMore && !isLoading && (
              <button onClick={loadMore} className="glass-button w-full py-3 text-sm font-medium text-primary-500">
                Muat lebih banyak
              </button>
            )}
          </div>
        )}

        {isLoading && <SkeletonList rows={3} />}
      </div>

      <BottomNavigation />
    </div>
  );
}
