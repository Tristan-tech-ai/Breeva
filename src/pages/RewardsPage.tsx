import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Star, Sparkles, Gift } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';

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
  const { profile } = useAuthStore();
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');

  useEffect(() => {
    const fetchRewards = async () => {
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
    };

    fetchRewards();
  }, []);

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

        {/* Voucher categories */}
        <div className="px-4 flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-medium transition ${
                cat === selectedCategory
                  ? 'gradient-primary text-white shadow-sm shadow-primary-500/25'
                  : 'bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm border border-gray-200/30 dark:border-gray-700/20 text-gray-600 dark:text-gray-300 hover:bg-white/80 dark:hover:bg-gray-800/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-4">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading rewards...</p>
            </div>
          ) : rewards.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <Gift size={40} className="text-gray-300 dark:text-gray-600" />
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400">No Rewards Available Yet</h3>
              <p className="text-xs text-gray-400 max-w-xs">
                Rewards from eco-merchants will appear here soon. Keep walking to earn EcoPoints!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {rewards.map((reward, i) => (
                <motion.div
                  key={reward.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-2xl bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/30 dark:border-gray-700/20 shadow-sm overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="h-24 flex items-center justify-center text-3xl bg-gradient-to-br from-primary-100 to-secondary-100 dark:from-primary-900/30 dark:to-secondary-900/30">
                    {reward.discount_percentage ? `${reward.discount_percentage}%` : '🎁'}
                  </div>
                  <div className="p-3">
                    <h3 className="text-xs font-bold text-gray-900 dark:text-white line-clamp-2">{reward.title}</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">{(reward.merchant as { name: string } | null)?.name || 'Breeva'}</p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        <Star size={10} className="text-amber-400" fill="currentColor" />
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums">{reward.points_required}</span>
                      </div>
                      {reward.remaining_stock != null && (
                        <span className="text-[10px] text-gray-400">{reward.remaining_stock} left</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
