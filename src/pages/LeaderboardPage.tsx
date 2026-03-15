import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Crown, Medal, Award, Footprints } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';
import { useVirtualizer } from '@tanstack/react-virtual';

interface LeaderboardEntry {
  user_id: string;
  name: string;
  avatar_url: string | null;
  total_distance_km: number;
  total_walks: number;
  ecopoints_balance: number;
}

function VirtualizedList({ entries, userId, activeTab }: { entries: LeaderboardEntry[]; userId?: string; activeTab: 'points' | 'distance' }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="max-h-[60vh] overflow-auto scrollbar-hide rounded-xl">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem: { index: number; start: number; size: number }) => {
          const e = entries[vItem.index];
          const rank = vItem.index + 4;
          const isMe = e.user_id === userId;
          return (
            <div
              key={e.user_id}
              ref={virtualizer.measureElement}
              data-index={vItem.index}
              className="absolute left-0 right-0"
              style={{ top: vItem.start }}
            >
              <div className={`glass-card p-3 flex items-center gap-3 mb-2 ${isMe ? 'border border-primary-200 dark:border-primary-800' : ''}`}>
                <span className="w-7 text-center text-xs font-bold text-gray-400">{rank}</span>
                <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800 flex-shrink-0">
                  {e.avatar_url ? (
                    <img src={e.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-400">
                      {e.name[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {e.name} {isMe && <span className="text-primary-500">(You)</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <Footprints className="w-3 h-3" /> {e.total_walks} walks
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-primary-500">
                    {activeTab === 'points' ? `${e.ecopoints_balance}` : e.total_distance_km.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {activeTab === 'points' ? 'pts' : 'km'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'points' | 'distance'>('points');

  const fetchLeaderboard = useCallback(async () => {
    setIsLoading(true);
    const sortCol = activeTab === 'points' ? 'ecopoints_balance' : 'total_distance_km';

    const { data } = await supabase
      .from('users')
      .select('id, full_name, avatar_url, total_distance_km, total_walks, ecopoints_balance')
      .order(sortCol, { ascending: false })
      .limit(50);

    if (data) {
      setEntries(
        data.map((u) => ({
          user_id: u.id,
          name: u.full_name || 'Green Walker',
          avatar_url: u.avatar_url,
          total_distance_km: u.total_distance_km || 0,
          total_walks: u.total_walks || 0,
          ecopoints_balance: u.ecopoints_balance || 0,
        }))
      );
    }
    setIsLoading(false);
  }, [activeTab]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const myRank = entries.findIndex((e) => e.user_id === user?.id) + 1;

  const podiumIcons = [
    <Crown key="1" className="w-5 h-5 text-yellow-400" />,
    <Medal key="2" className="w-5 h-5 text-gray-400" />,
    <Award key="3" className="w-5 h-5 text-amber-600" />,
  ];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Leaderboard</h1>
        <div className="w-6" />
      </div>

      <div className="px-4 pt-4 pb-12">
        {/* My Rank */}
        {myRank > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-4 mb-5 flex items-center gap-3 border border-primary-200 dark:border-primary-800"
          >
            <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-white font-bold text-sm">
              #{myRank}
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Your Rank</div>
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                {activeTab === 'points'
                  ? `${entries[myRank - 1]?.ecopoints_balance || 0} pts`
                  : `${(entries[myRank - 1]?.total_distance_km || 0).toFixed(1)} km`}
              </div>
            </div>
          </motion.div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {(['points', 'distance'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'gradient-primary text-white shadow-md'
                  : 'glass-card text-gray-600 dark:text-gray-400'
              }`}
            >
              {tab === 'points' ? 'EcoPoints' : 'Distance'}
            </button>
          ))}
        </div>

        {/* Podium (top 3) */}
        {!isLoading && entries.length >= 3 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-end justify-center gap-3 mb-6"
          >
            {[1, 0, 2].map((idx) => {
              const e = entries[idx];
              if (!e) return null;
              const isFirst = idx === 0;
              return (
                <div
                  key={e.user_id}
                  className={`flex flex-col items-center ${isFirst ? 'order-2' : idx === 1 ? 'order-1' : 'order-3'}`}
                >
                  <div className="mb-1">{podiumIcons[idx]}</div>
                  <div
                    className={`rounded-full border-2 overflow-hidden bg-gray-200 dark:bg-gray-800 ${
                      isFirst ? 'w-16 h-16 border-yellow-400' : 'w-12 h-12 border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {e.avatar_url ? (
                      <img src={e.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm font-bold text-gray-400">
                        {e.name[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-gray-900 dark:text-white text-center truncate max-w-[80px]">
                    {e.name}
                  </div>
                  <div className="text-[10px] text-primary-500 font-medium">
                    {activeTab === 'points' ? `${e.ecopoints_balance} pts` : `${e.total_distance_km.toFixed(1)} km`}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">
            {/* Podium skeleton */}
            <div className="flex items-end justify-center gap-3 mb-6">
              {[44, 60, 44].map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 animate-pulse">
                  <div className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className={`rounded-full bg-gray-200 dark:bg-gray-700`} style={{ width: s, height: s }} />
                  <div className="w-14 h-3 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="w-10 h-2.5 rounded bg-gray-100 dark:bg-gray-800" />
                </div>
              ))}
            </div>
            {/* List skeleton */}
            {[...Array(6)].map((_, i) => (
              <div key={i} className="glass-card p-3 flex items-center gap-3 animate-pulse">
                <div className="w-6 h-4 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-1.5">
                  <div className="w-24 h-3.5 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="w-16 h-2.5 rounded bg-gray-100 dark:bg-gray-800" />
                </div>
                <div className="w-12 h-4 rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            ))}
          </div>
        ) : (
          <VirtualizedList entries={entries.slice(3)} userId={user?.id} activeTab={activeTab} />
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
