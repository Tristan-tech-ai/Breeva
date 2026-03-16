import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Star, Sparkles, Gift, Ticket, QrCode, RotateCcw,
  Coffee, ShoppingBag, Dumbbell, Film, Tag,
  ArrowRight, Clock, Search, SlidersHorizontal,
  ChevronDown, TrendingUp, Coins, CheckCircle2, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { cacheCollection, getCachedCollection } from '../lib/offline-db';
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

type VoucherStatus = 'active' | 'used' | 'expired';

interface Voucher {
  id: string;
  qr_code: string;
  backup_code: string;
  status: string;
  points_spent: number;
  expires_at: string;
  created_at: string;
  reward: { title: string } | null;
  merchant: { name: string } | null;
}

interface CategoryDef {
  label: string;
  icon: LucideIcon;
  key: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'all', label: 'All', icon: Tag },
  { key: 'food', label: 'Food & Drink', icon: Coffee },
  { key: 'shopping', label: 'Shopping', icon: ShoppingBag },
  { key: 'wellness', label: 'Wellness', icon: Dumbbell },
  { key: 'entertainment', label: 'Entertainment', icon: Film },
];

type SortOption = 'points-asc' | 'points-desc' | 'newest';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'points-asc', label: 'Points: Low to High' },
  { value: 'points-desc', label: 'Points: High to Low' },
  { value: 'newest', label: 'Newest First' },
];

function getStatusConfig(status: string): { icon: LucideIcon; color: string; bg: string; label: string } {
  switch (status) {
    case 'active':
      return { icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', label: 'Active' };
    case 'used':
      return { icon: CheckCircle2, color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800/60', label: 'Used' };
    default:
      return { icon: XCircle, color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Expired' };
  }
}

function formatExpiry(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return 'Expired';
  const days = Math.ceil(diff / 86_400_000);
  if (days <= 1) return 'Expires today';
  if (days <= 7) return `${days}d left`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function RewardsPage() {
  const { profile, user } = useAuthStore();
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState<'available' | 'my-vouchers'>('available');
  const [selectedReward, setSelectedReward] = useState<RewardRow | null>(null);
  const [myVouchers, setMyVouchers] = useState<Voucher[]>([]);
  const [flippedVoucher, setFlippedVoucher] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('points-asc');
  const [showSort, setShowSort] = useState(false);
  const [voucherFilter, setVoucherFilter] = useState<'all' | VoucherStatus>('all');

  const balance = profile?.ecopoints_balance || 0;

  const fetchRewards = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!navigator.onLine) {
        const offlineRewards = await getCachedCollection<RewardRow>('rewards');
        if (offlineRewards.length > 0) {
          setRewards(offlineRewards);
          return;
        }
      }

      const { data, error } = await supabase
        .from('rewards')
        .select('id, title, description, points_required, remaining_stock, discount_percentage, merchant:merchants(name)')
        .eq('is_active', true)
        .gte('valid_until', new Date().toISOString().split('T')[0])
        .order('points_required', { ascending: true });

      if (error) throw error;
      setRewards((data || []) as unknown as RewardRow[]);
      cacheCollection('rewards', (data || []) as unknown as RewardRow[]).catch(() => {});
    } catch (err) {
      console.error('Failed to fetch rewards:', err);
      const offlineRewards = await getCachedCollection<RewardRow>('rewards');
      if (offlineRewards.length > 0) {
        setRewards(offlineRewards);
      }
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
        })) as Voucher[]
      );
    } catch (err) {
      console.error('Failed to fetch vouchers:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchRewards();
    fetchMyVouchers();
  }, [fetchRewards, fetchMyVouchers]);

  // Filtered & sorted rewards
  const filteredRewards = useMemo(() => {
    let list = [...rewards];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          ((r.merchant as { name: string } | null)?.name || '').toLowerCase().includes(q)
      );
    }
    switch (sortBy) {
      case 'points-desc':
        list.sort((a, b) => b.points_required - a.points_required);
        break;
      case 'newest':
        list.reverse();
        break;
      default:
        list.sort((a, b) => a.points_required - b.points_required);
    }
    return list;
  }, [rewards, searchQuery, sortBy]);

  // Filtered vouchers
  const filteredVouchers = useMemo(() => {
    if (voucherFilter === 'all') return myVouchers;
    return myVouchers.filter((v) => v.status === voucherFilter);
  }, [myVouchers, voucherFilter]);

  // Stats
  const redeemableCount = rewards.filter((r) => balance >= r.points_required).length;

  const ActiveTabIcon = activeTab === 'available' ? Gift : Ticket;

  return (
    <div className="gradient-mesh-bg min-h-screen pb-20">
      <div className="max-w-2xl mx-auto">
        {/* ─── Header ─── */}
        <div className="safe-area-top px-5 pt-5 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Rewards</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Redeem EcoPoints for exclusive offers
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <ActiveTabIcon size={20} className="text-primary-600 dark:text-primary-400" />
            </div>
          </div>
        </div>

        {/* ─── Balance Card ─── */}
        <div className="px-5 mt-4 mb-5">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 via-primary-500 to-teal-600 p-5 shadow-xl shadow-primary-500/15">
            {/* Subtle pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full border-[20px] border-white/20" />
              <div className="absolute -left-4 -bottom-4 w-24 h-24 rounded-full border-[16px] border-white/15" />
            </div>
            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-white/70 text-xs font-medium uppercase tracking-wider">Your Balance</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-4xl font-extrabold text-white tabular-nums tracking-tight">
                    {balance.toLocaleString()}
                  </span>
                  <span className="text-sm font-medium text-white/60">pts</span>
                </div>
                {redeemableCount > 0 && (
                  <p className="text-xs text-white/60 mt-1.5 flex items-center gap-1">
                    <TrendingUp size={12} />
                    {redeemableCount} reward{redeemableCount !== 1 ? 's' : ''} available to redeem
                  </p>
                )}
              </div>
              <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <Coins size={28} className="text-amber-200" />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Tabs ─── */}
        <div className="px-5 mb-4">
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800/60 p-1">
            {(['available', 'my-vouchers'] as const).map((tab) => {
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    isActive
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="rewards-tab-indicator"
                      className="absolute inset-0 bg-white dark:bg-gray-700 rounded-lg shadow-sm"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center justify-center gap-1.5">
                    {tab === 'available' ? (
                      <>
                        <Gift size={14} />
                        Available
                      </>
                    ) : (
                      <>
                        <Ticket size={14} />
                        My Vouchers
                        {myVouchers.length > 0 && (
                          <span className="ml-0.5 w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center">
                            {myVouchers.length}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'available' && (
            <motion.div
              key="available"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              {/* ─── Search + Sort Bar ─── */}
              <div className="px-5 mb-3 flex gap-2">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search rewards..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/40 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition"
                  />
                </div>
                <div className="relative">
                  <button
                    onClick={() => setShowSort(!showSort)}
                    className="h-full px-3 rounded-xl bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/40 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition flex items-center gap-1.5"
                  >
                    <SlidersHorizontal size={16} />
                    <ChevronDown size={12} className={`transition-transform ${showSort ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showSort && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700/40 overflow-hidden z-20"
                      >
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                            className={`w-full px-4 py-2.5 text-left text-xs font-medium transition ${
                              sortBy === opt.value
                                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* ─── Category Pills ─── */}
              <div className="px-5 flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
                {CATEGORIES.map((cat) => {
                  const isActive = cat.key === selectedCategory;
                  const CatIcon = cat.icon;
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setSelectedCategory(cat.key)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 ${
                        isActive
                          ? 'gradient-primary text-white shadow-md shadow-primary-500/20'
                          : 'bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300 hover:border-primary-300 dark:hover:border-primary-700'
                      }`}
                    >
                      <CatIcon size={14} />
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              {/* ─── Featured Carousel ─── */}
              {!isLoading && rewards.length > 0 && (
                <div className="mb-5">
                  <div className="px-5 flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Featured Rewards</h3>
                    <span className="text-xs text-primary-500 font-medium">{rewards.length} total</span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x snap-mandatory scrollbar-hide">
                    {rewards.slice(0, 5).map((reward, i) => {
                      const canAfford = balance >= reward.points_required;
                      const progress = Math.min((balance / reward.points_required) * 100, 100);
                      return (
                        <motion.div
                          key={`feat-${reward.id}`}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.06 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => canAfford && setSelectedReward(reward)}
                          className={`flex-shrink-0 w-[220px] snap-center rounded-2xl overflow-hidden shadow-lg ${
                            canAfford ? 'cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          <div className="bg-gradient-to-br from-emerald-500 via-primary-500 to-teal-600 p-4 pb-3">
                            <div className="flex items-start justify-between mb-3">
                              <div className="text-3xl font-black text-white/90">
                                {reward.discount_percentage ? `${reward.discount_percentage}%` : <Gift size={28} />}
                              </div>
                              {canAfford && (
                                <span className="text-[10px] font-bold bg-white/20 backdrop-blur-sm text-white px-2 py-0.5 rounded-full">
                                  Redeemable
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-bold text-white line-clamp-1">{reward.title}</h4>
                            <p className="text-[11px] text-white/60 mt-0.5">{(reward.merchant as { name: string } | null)?.name || 'Breeva'}</p>
                          </div>
                          <div className="bg-white dark:bg-gray-900/90 p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                <Star size={12} className="text-amber-400" fill="currentColor" />
                                <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                                  {reward.points_required.toLocaleString()}
                                </span>
                                <span className="text-[10px] text-gray-400">pts</span>
                              </div>
                              {canAfford && <ArrowRight size={14} className="text-primary-500" />}
                            </div>
                            {!canAfford && (
                              <div className="mt-2">
                                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">
                                  {(reward.points_required - balance).toLocaleString()} pts more needed
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ─── Reward Grid ─── */}
              <div className="px-5">
                {!isLoading && filteredRewards.length > 0 && (
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      All Rewards
                      {searchQuery && (
                        <span className="ml-2 text-xs text-gray-400 font-normal">
                          {filteredRewards.length} result{filteredRewards.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </h3>
                  </div>
                )}

                {isLoading ? (
                  <SkeletonGrid count={4} />
                ) : filteredRewards.length === 0 ? (
                  <EmptyState
                    icon={Gift}
                    title={searchQuery ? 'No Results Found' : 'No Rewards Available Yet'}
                    description={
                      searchQuery
                        ? `No rewards matching "${searchQuery}". Try a different search.`
                        : 'Rewards from eco-merchants will appear here soon. Keep walking to earn EcoPoints!'
                    }
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredRewards.map((reward, i) => {
                      const canAfford = balance >= reward.points_required;
                      const progress = Math.min((balance / reward.points_required) * 100, 100);
                      const stockLow = reward.remaining_stock != null && reward.remaining_stock <= 5 && reward.remaining_stock > 0;
                      return (
                        <motion.div
                          key={reward.id}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04, duration: 0.3 }}
                          className="group rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-100 dark:border-gray-700/30 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                        >
                          {/* Visual header */}
                          <div className="relative h-24 flex items-center justify-center bg-gradient-to-br from-primary-50 via-emerald-50 to-teal-50 dark:from-primary-900/20 dark:via-emerald-900/15 dark:to-teal-900/20">
                            <span className="text-3xl font-black text-primary-500/80 dark:text-primary-400/60">
                              {reward.discount_percentage ? `${reward.discount_percentage}%` : <Gift size={32} strokeWidth={1.5} />}
                            </span>
                            {stockLow && (
                              <span className="absolute top-2 right-2 text-[9px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-md">
                                {reward.remaining_stock} left
                              </span>
                            )}
                            {canAfford && (
                              <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                                <Sparkles size={10} className="text-white" />
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="p-3.5">
                            <h3 className="text-xs font-bold text-gray-900 dark:text-white line-clamp-2 leading-snug">
                              {reward.title}
                            </h3>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 truncate">
                              {(reward.merchant as { name: string } | null)?.name || 'Breeva'}
                            </p>

                            {/* Points + Progress */}
                            <div className="mt-2.5">
                              <div className="flex items-center gap-1">
                                <Star size={11} className="text-amber-400" fill="currentColor" />
                                <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                                  {reward.points_required.toLocaleString()}
                                </span>
                                <span className="text-[10px] text-gray-400">pts</span>
                              </div>
                              {!canAfford && (
                                <div className="mt-1.5">
                                  <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* CTA */}
                            <button
                              onClick={() => canAfford && setSelectedReward(reward)}
                              disabled={!canAfford}
                              className={`w-full mt-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 flex items-center justify-center gap-1.5 ${
                                canAfford
                                  ? 'gradient-primary text-white shadow-sm shadow-primary-500/20 hover:shadow-md active:scale-[0.98]'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              {canAfford ? (
                                <>
                                  Redeem
                                  <ArrowRight size={12} />
                                </>
                              ) : (
                                `${(reward.points_required - balance).toLocaleString()} pts more`
                              )}
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'my-vouchers' && (
            <motion.div
              key="vouchers"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.2 }}
            >
              {/* ─── Voucher Stats ─── */}
              {myVouchers.length > 0 && (
                <div className="px-5 mb-4">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Active', count: myVouchers.filter((v) => v.status === 'active').length, color: 'text-emerald-600 dark:text-emerald-400' },
                      { label: 'Used', count: myVouchers.filter((v) => v.status === 'used').length, color: 'text-gray-500 dark:text-gray-400' },
                      { label: 'Expired', count: myVouchers.filter((v) => v.status === 'expired').length, color: 'text-red-500 dark:text-red-400' },
                    ].map((stat) => (
                      <div key={stat.label} className="glass-card p-3 text-center">
                        <p className={`text-lg font-bold tabular-nums ${stat.color}`}>{stat.count}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Voucher Filter Chips ─── */}
              {myVouchers.length > 0 && (
                <div className="px-5 flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
                  {(['all', 'active', 'used', 'expired'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setVoucherFilter(f)}
                      className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                        voucherFilter === f
                          ? 'gradient-primary text-white shadow-sm'
                          : 'bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {f === 'all' ? `All (${myVouchers.length})` : `${f.charAt(0).toUpperCase()}${f.slice(1)}`}
                    </button>
                  ))}
                </div>
              )}

              {/* ─── Voucher List ─── */}
              <div className="px-5">
                {myVouchers.length === 0 ? (
                  <EmptyState
                    icon={Ticket}
                    title="No Vouchers Yet"
                    description="Redeem your EcoPoints to get vouchers from eco-merchants."
                    actionLabel="Browse Rewards"
                    onAction={() => setActiveTab('available')}
                  />
                ) : filteredVouchers.length === 0 ? (
                  <EmptyState
                    icon={Ticket}
                    title="No Matching Vouchers"
                    description={`You don't have any ${voucherFilter} vouchers.`}
                  />
                ) : (
                  <div className="space-y-3">
                    {filteredVouchers.map((v, i) => {
                      const isFlipped = flippedVoucher === v.id;
                      const statusCfg = getStatusConfig(v.status);
                      const StatusIcon = statusCfg.icon;
                      return (
                        <motion.div
                          key={v.id}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="relative h-[100px] cursor-pointer"
                          style={{ perspective: '800px' }}
                          onClick={() => setFlippedVoucher(isFlipped ? null : v.id)}
                        >
                          <motion.div
                            animate={{ rotateY: isFlipped ? 180 : 0 }}
                            transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
                            style={{ transformStyle: 'preserve-3d' }}
                            className="absolute inset-0"
                          >
                            {/* Front */}
                            <div
                              className="absolute inset-0 rounded-2xl bg-white dark:bg-gray-900/80 border border-gray-100 dark:border-gray-700/30 shadow-sm p-4 flex items-center gap-3"
                              style={{ backfaceVisibility: 'hidden' }}
                            >
                              {/* Dashed divider */}
                              <div className="absolute left-[60px] top-2 bottom-2 border-l border-dashed border-gray-200 dark:border-gray-700/50" />

                              <div className={`w-11 h-11 rounded-xl ${statusCfg.bg} flex items-center justify-center flex-shrink-0`}>
                                <QrCode size={20} className={statusCfg.color} />
                              </div>

                              <div className="flex-1 min-w-0 pl-2">
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                  {(v.reward as { title: string } | null)?.title || 'Reward'}
                                </h4>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                  {(v.merchant as { name: string } | null)?.name}
                                  <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                                  {v.points_spent.toLocaleString()} pts
                                </p>
                                <div className="flex items-center gap-1 mt-1.5">
                                  <Clock size={10} className="text-gray-400" />
                                  <span className="text-[10px] text-gray-400">{formatExpiry(v.expires_at)}</span>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-1.5">
                                <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg ${statusCfg.bg} ${statusCfg.color}`}>
                                  <StatusIcon size={10} />
                                  {statusCfg.label}
                                </span>
                                <span className="text-[9px] text-gray-400 dark:text-gray-500">Tap to reveal</span>
                              </div>
                            </div>

                            {/* Back */}
                            <div
                              className="absolute inset-0 rounded-2xl bg-gradient-to-r from-emerald-50 via-white to-teal-50 dark:from-emerald-900/10 dark:via-gray-900/80 dark:to-teal-900/10 border border-primary-200 dark:border-primary-800/30 shadow-sm p-4 flex items-center justify-center"
                              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                            >
                              <div className="text-center">
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium mb-1">Redemption Code</p>
                                <p className="text-xl font-mono font-bold text-primary-600 dark:text-primary-400 tracking-[0.2em]">{v.qr_code}</p>
                                <p className="text-[10px] text-gray-400 mt-1.5 font-mono">Backup: {v.backup_code}</p>
                              </div>
                              <RotateCcw size={14} className="text-gray-400 absolute top-3.5 right-3.5" />
                            </div>
                          </motion.div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
