import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Star, Sparkles, Gift, Ticket, QrCode } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import RewardRedemptionModal from '../components/features/RewardRedemptionModal';
import { SkeletonGrid } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

interface RewardRow {
  id: string;
  title: string;
  description: string | null;
  points_required: number;
  remaining_stock: number | null;
  discount_percentage: number | null;
  merchant: { name: string } | null;
}

export default function RewardsPage() {
  const { profile, user } = useAuthStore();
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeTab, setActiveTab] = useState<'available' | 'my-vouchers'>('available');
  const [selectedReward, setSelectedReward] = useState<RewardRow | null>(null);
  const [myVouchers, setMyVouchers] = useState<Array<{
    id: string;
    qr_code: string;
    backup_code: string;
    status: string;
    points_spent: number;
    expires_at: string;
    created_at: string;
    reward: { title: string } | null;
    merchant: { name: string } | null;
  }>>([]);

  const fetchRewards = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('rewards')
        .select('id, title, description, points_required, remaining_stock, discount_percentage, merchant:merchants(name)')
        .eq('is_active', true)
        .gte('valid_until', new Date().toISOString().split('T')[0])
        .order('points_required', { ascending: true });

      if (error) throw error;
      setRewards((data || []) as unknown as RewardRow[]);
    } catch (err) {
      console.error('Failed to fetch rewards:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchMyVouchers = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('redeemed_rewards')
        .select('id, qr_code, backup_code, status, points_spent, expires_at, created_at, reward:rewards(title), merchant:merchants(name)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMyVouchers(
        (data || []).map((d: Record<string, unknown>) => ({
          ...d,
          reward: Array.isArray(d.reward) ? d.reward[0] || null : d.reward,
          merchant: Array.isArray(d.merchant) ? d.merchant[0] || null : d.merchant,
        })) as typeof myVouchers
      );
    } catch (err) {
      console.error('Failed to fetch vouchers:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchRewards();
    fetchMyVouchers();
  }, [fetchRewards, fetchMyVouchers]);

  const categories = ['All', '☕ Food & Drink', '🛍️ Shopping', '🏋️ Wellness', '🎬 Entertainment'];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-20">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="safe-area-top px-4 pt-4 pb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Rewards</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Redeem your EcoPoints for vouchers</p>
        </div>

        {/* Points balance */}
        <div className="px-4 mb-6">
          <div className="gradient-primary rounded-2xl p-5 text-center shadow-lg shadow-primary-500/20">
            <p className="text-white/80 text-xs mb-1">Your Balance</p>
            <div className="flex items-center justify-center gap-2">
              <Sparkles size={22} className="text-amber-300" />
              <span className="text-3xl font-bold text-white tabular-nums">{profile?.ecopoints_balance || 0}</span>
            </div>
            <p className="text-white/60 text-xs mt-1">EcoPoints</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 flex gap-2 mb-3">
          {(['available', 'my-vouchers'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition ${
                tab === activeTab
                  ? 'gradient-primary text-white shadow-sm'
                  : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300'
              }`}
            >
              {tab === 'available' ? 'Available Rewards' : `My Vouchers (${myVouchers.length})`}
            </button>
          ))}
        </div>

        {activeTab === 'available' && (
          <>
            {/* Voucher categories */}
            <div className="px-4 flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-medium transition ${
                    cat === selectedCategory
                      ? 'gradient-primary text-white shadow-sm shadow-primary-500/25'
                      : 'bg-white dark:bg-gray-900/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300 hover:bg-white dark:bg-gray-900/80 dark:hover:bg-gray-800/60'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="px-4">
              {isLoading ? (
                <SkeletonGrid count={4} />
              ) : rewards.length === 0 ? (
                <EmptyState
                  icon={Gift}
                  title="No Rewards Available Yet"
                  description="Rewards from eco-merchants will appear here soon. Keep walking to earn EcoPoints!"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {rewards.map((reward, i) => {
                    const canAfford = (profile?.ecopoints_balance || 0) >= reward.points_required;
                    return (
                      <motion.div
                        key={reward.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm overflow-hidden"
                      >
                        <div className="h-24 flex items-center justify-center text-3xl bg-gradient-to-br from-primary-100 to-secondary-100 dark:from-primary-900/30 dark:to-secondary-900/30">
                          {reward.discount_percentage ? `${reward.discount_percentage}%` : '🎁'}
                        </div>
                        <div className="p-3">
                          <h3 className="text-xs font-bold text-gray-900 dark:text-white line-clamp-2">{reward.title}</h3>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{(reward.merchant as { name: string } | null)?.name || 'Breeva'}</p>
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-1">
                              <Star size={10} className="text-amber-400" fill="currentColor" />
                              <span className="text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums">{reward.points_required}</span>
                            </div>
                            {reward.remaining_stock != null && (
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">{reward.remaining_stock} left</span>
                            )}
                          </div>
                          <button
                            onClick={() => canAfford && setSelectedReward(reward)}
                            disabled={!canAfford}
                            className={`w-full mt-2 py-2 rounded-xl text-xs font-semibold transition ${
                              canAfford
                                ? 'gradient-primary text-white shadow-sm'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {canAfford ? 'Redeem' : 'Not enough pts'}
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'my-vouchers' && (
          <div className="px-4">
            {myVouchers.length === 0 ? (
              <EmptyState
                icon={Ticket}
                title="No Vouchers Yet"
                description="Redeem your EcoPoints to get vouchers from eco-merchants."
              />
            ) : (
              <div className="space-y-3">
                {myVouchers.map((v) => (
                  <div
                    key={v.id}
                    className="glass-card p-4 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                      <QrCode size={20} className="text-primary-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {(v.reward as { title: string } | null)?.title || 'Reward'}
                      </h4>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {(v.merchant as { name: string } | null)?.name} · {v.points_spent} pts
                      </p>
                      <p className="text-[10px] font-mono text-gray-400 mt-0.5">{v.qr_code}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                      v.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      v.status === 'used' ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' :
                      'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {v.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Redemption Modal */}
        {selectedReward && (
          <RewardRedemptionModal
            reward={selectedReward}
            onClose={() => setSelectedReward(null)}
            onSuccess={() => {
              fetchRewards();
              fetchMyVouchers();
            }}
          />
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
