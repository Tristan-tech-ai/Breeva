import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  BadgeCheck,
  Star,
  Gift,
  QrCode,
  MessageSquare,
  Crown,
  Plus,
  Pencil,
  Trash2,
  Package,
  TrendingUp,
  Loader2,
  Leaf,
  Zap,
  Sparkles,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { SkeletonList } from '../components/ui/Skeleton';
import toast from 'react-hot-toast';

// ── Types ────────────────────────────────────────────────────────────

interface MerchantData {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  lat: number;
  lng: number;
  logo_url: string | null;
  is_verified: boolean;
  is_active: boolean;
  rating: number;
  review_count: number;
  sponsor_tier: string;
  sponsor_expires_at: string | null;
  priority_boost: number;
  owner_id: string;
}

interface RewardRow {
  id: string;
  title: string;
  description: string | null;
  points_required: number;
  discount_percentage: number | null;
  discount_amount: number | null;
  remaining_stock: number | null;
  total_stock: number | null;
  valid_until: string;
  is_active: boolean;
}

interface RedemptionRow {
  id: string;
  created_at: string;
  status: string;
  reward: { title: string } | null;
}

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  user: { full_name: string; avatar_url: string | null } | null;
}

// ── Sponsor tier config ──────────────────────────────────────────────

const SPONSOR_TIERS = [
  { key: 'free',     label: 'Free',     cost: 0,    boost: 0, icon: Leaf,     color: 'text-gray-400',  badge: '',         desc: 'Basic listing' },
  { key: 'basic',    label: 'Basic',    cost: 500,  boost: 1, icon: Leaf,     color: 'text-emerald-500', badge: '🌱',     desc: 'Visible at z14, filter highlight' },
  { key: 'premium',  label: 'Premium',  cost: 1500, boost: 2, icon: Zap,      color: 'text-amber-500', badge: '🌿🌿',   desc: 'Prominent marker, top of list' },
  { key: 'featured', label: 'Featured', cost: 3000, boost: 3, icon: Sparkles, color: 'text-purple-500', badge: '🌳🌳🌳', desc: 'Always visible, homepage spotlight' },
];

// ── Tab definitions ──────────────────────────────────────────────────

type Tab = 'overview' | 'rewards' | 'redemptions' | 'reviews' | 'sponsor';

const TABS: { key: Tab; label: string; icon: typeof Gift }[] = [
  { key: 'overview',    label: 'Overview',    icon: TrendingUp },
  { key: 'rewards',     label: 'Rewards',     icon: Gift },
  { key: 'redemptions', label: 'Redeemed',    icon: QrCode },
  { key: 'reviews',     label: 'Reviews',     icon: MessageSquare },
  { key: 'sponsor',     label: 'Sponsor',     icon: Crown },
];

// ── Component ────────────────────────────────────────────────────────

export default function MerchantDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [merchant, setMerchant] = useState<MerchantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');

  // Data for each tab
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [totalRedemptions, setTotalRedemptions] = useState(0);

  // Reward form
  const [showRewardForm, setShowRewardForm] = useState(false);
  const [rewardForm, setRewardForm] = useState({
    title: '', description: '', points_required: 100,
    discount_percentage: 10, total_stock: 50, valid_days: 30,
  });
  const [savingReward, setSavingReward] = useState(false);

  // Sponsor upgrade
  const [upgrading, setUpgrading] = useState(false);

  // ── Fetch merchant ─────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        toast.error('Merchant not found');
        navigate('/merchants');
        return;
      }

      // Verify ownership
      if (data.owner_id !== user?.id) {
        toast.error('Access denied');
        navigate('/merchants');
        return;
      }

      setMerchant(data);
      setLoading(false);
    })();
  }, [id, user, navigate]);

  // ── Fetch tab data ─────────────────────────────────────────────────

  const fetchRewards = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('rewards')
      .select('*')
      .eq('merchant_id', id)
      .order('created_at', { ascending: false });
    setRewards(data || []);
  }, [id]);

  const fetchRedemptions = useCallback(async () => {
    if (!id) return;
    const { data, count } = await supabase
      .from('redeemed_rewards')
      .select('id, created_at, status, reward:rewards(title)', { count: 'exact' })
      .eq('merchant_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    setRedemptions((data || []) as unknown as RedemptionRow[]);
    setTotalRedemptions(count || 0);
  }, [id]);

  const fetchReviews = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at, user:users(full_name, avatar_url)')
      .eq('merchant_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    setReviews((data || []) as unknown as ReviewRow[]);
  }, [id]);

  useEffect(() => {
    if (!merchant) return;
    if (tab === 'rewards') fetchRewards();
    if (tab === 'redemptions') fetchRedemptions();
    if (tab === 'reviews') fetchReviews();
  }, [tab, merchant, fetchRewards, fetchRedemptions, fetchReviews]);

  // Also fetch overview stats
  useEffect(() => {
    if (!merchant) return;
    fetchRewards();
    fetchRedemptions();
  }, [merchant, fetchRewards, fetchRedemptions]);

  // ── Create reward ──────────────────────────────────────────────────

  const handleCreateReward = async () => {
    if (!id || !rewardForm.title.trim()) return;
    setSavingReward(true);

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + rewardForm.valid_days);

    const { error } = await supabase.from('rewards').insert({
      merchant_id: id,
      title: rewardForm.title.trim(),
      description: rewardForm.description.trim() || null,
      points_required: rewardForm.points_required,
      discount_percentage: rewardForm.discount_percentage,
      total_stock: rewardForm.total_stock,
      remaining_stock: rewardForm.total_stock,
      valid_until: validUntil.toISOString().split('T')[0],
      is_active: true,
    });

    setSavingReward(false);
    if (error) {
      toast.error('Failed to create reward');
    } else {
      toast.success('Reward created!');
      setShowRewardForm(false);
      setRewardForm({ title: '', description: '', points_required: 100, discount_percentage: 10, total_stock: 50, valid_days: 30 });
      fetchRewards();
    }
  };

  // ── Toggle reward active ───────────────────────────────────────────

  const toggleRewardActive = async (rewardId: string, currentActive: boolean) => {
    const { error } = await supabase
      .from('rewards')
      .update({ is_active: !currentActive })
      .eq('id', rewardId);
    if (!error) fetchRewards();
  };

  // ── Sponsor upgrade ────────────────────────────────────────────────

  const handleUpgrade = async (tierKey: string, cost: number) => {
    if (!id || !user) return;
    setUpgrading(true);

    const { data, error } = await supabase.rpc('upgrade_merchant_sponsor', {
      p_merchant_id: id,
      p_user_id: user.id,
      p_tier: tierKey,
      p_cost: cost,
    });

    setUpgrading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const result = data?.[0] || data;
    if (result?.success) {
      toast.success(result.message);
      // Refresh merchant data
      const { data: updated } = await supabase.from('merchants').select('*').eq('id', id).single();
      if (updated) setMerchant(updated);
    } else {
      toast.error(result?.message || 'Upgrade failed');
    }
  };

  // ── Loading state ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="gradient-mesh-bg min-h-screen">
        <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-base font-semibold text-gray-900 dark:text-white">Merchant Dashboard</h1>
        </div>
        <div className="px-4 pt-6"><SkeletonList rows={5} /></div>
      </div>
    );
  }

  if (!merchant) return null;

  const currentTier = SPONSOR_TIERS.find(t => t.key === merchant.sponsor_tier) || SPONSOR_TIERS[0];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-8">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate">{merchant.name}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Dashboard</p>
        </div>
        {merchant.is_verified && <BadgeCheck className="w-5 h-5 text-primary-500 flex-shrink-0" />}
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 flex gap-1.5 overflow-x-auto scrollbar-hide">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              tab === t.key
                ? 'gradient-primary text-white shadow-sm'
                : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {/* ── OVERVIEW ───────────────────────────────────────── */}
            {tab === 'overview' && (
              <div className="space-y-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Rating" value={merchant.rating?.toFixed(1) || '—'} icon={Star} color="text-amber-500" />
                  <StatCard label="Reviews" value={String(merchant.review_count || 0)} icon={MessageSquare} color="text-blue-500" />
                  <StatCard label="Active Rewards" value={String(rewards.filter(r => r.is_active).length)} icon={Gift} color="text-emerald-500" />
                  <StatCard label="Total Redeemed" value={String(totalRedemptions)} icon={QrCode} color="text-purple-500" />
                </div>

                {/* Sponsor Badge */}
                <div className="glass-card p-4 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sponsor Tier</p>
                      <div className="flex items-center gap-2 mt-1">
                        <currentTier.icon className={`w-5 h-5 ${currentTier.color}`} />
                        <span className="text-lg font-bold text-gray-900 dark:text-white">{currentTier.label}</span>
                        {currentTier.badge && <span className="text-sm">{currentTier.badge}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => setTab('sponsor')}
                      className="text-xs font-medium text-primary-500 hover:text-primary-600"
                    >
                      Upgrade →
                    </button>
                  </div>
                  {merchant.sponsor_expires_at && (
                    <p className="text-[10px] text-gray-400 mt-2">
                      Expires: {new Date(merchant.sponsor_expires_at).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Merchant Info */}
                <div className="glass-card p-4 rounded-2xl space-y-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{merchant.category || 'General'}</p>
                  {merchant.address && <p className="text-xs text-gray-500 dark:text-gray-400">{merchant.address}</p>}
                  {merchant.description && <p className="text-xs text-gray-500 dark:text-gray-400">{merchant.description}</p>}
                </div>
              </div>
            )}

            {/* ── REWARDS ────────────────────────────────────────── */}
            {tab === 'rewards' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Your Rewards</p>
                  <button
                    onClick={() => setShowRewardForm(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg gradient-primary text-white text-xs font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>

                {rewards.length === 0 ? (
                  <div className="text-center py-8">
                    <Gift className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">No rewards yet. Create one!</p>
                  </div>
                ) : (
                  rewards.map(r => (
                    <div key={r.id} className="glass-card p-4 rounded-2xl">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{r.title}</h4>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              r.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              {r.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          {r.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{r.description}</p>}
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs font-medium text-primary-500">{r.points_required} pts</span>
                            {r.discount_percentage && <span className="text-xs text-gray-400">{r.discount_percentage}% off</span>}
                            <span className="text-xs text-gray-400">Stock: {r.remaining_stock ?? '∞'}/{r.total_stock ?? '∞'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleRewardActive(r.id, r.is_active)}
                          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                        >
                          {r.is_active ? <Trash2 className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {/* Reward Create Modal */}
                <AnimatePresence>
                  {showRewardForm && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                      onClick={() => setShowRewardForm(false)}
                    >
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-base font-bold text-gray-900 dark:text-white">New Reward</h3>
                          <button onClick={() => setShowRewardForm(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="w-5 h-5" />
                          </button>
                        </div>

                        <input
                          type="text"
                          placeholder="Reward title *"
                          value={rewardForm.title}
                          onChange={e => setRewardForm(f => ({ ...f, title: e.target.value }))}
                          className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400"
                        />
                        <textarea
                          placeholder="Description"
                          value={rewardForm.description}
                          onChange={e => setRewardForm(f => ({ ...f, description: e.target.value }))}
                          rows={2}
                          className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none"
                        />

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase">Points Required</label>
                            <input
                              type="number"
                              value={rewardForm.points_required}
                              onChange={e => setRewardForm(f => ({ ...f, points_required: +e.target.value }))}
                              min={1}
                              className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase">Discount %</label>
                            <input
                              type="number"
                              value={rewardForm.discount_percentage}
                              onChange={e => setRewardForm(f => ({ ...f, discount_percentage: +e.target.value }))}
                              min={0}
                              max={100}
                              className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase">Stock</label>
                            <input
                              type="number"
                              value={rewardForm.total_stock}
                              onChange={e => setRewardForm(f => ({ ...f, total_stock: +e.target.value }))}
                              min={1}
                              className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase">Valid (days)</label>
                            <input
                              type="number"
                              value={rewardForm.valid_days}
                              onChange={e => setRewardForm(f => ({ ...f, valid_days: +e.target.value }))}
                              min={1}
                              className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white"
                            />
                          </div>
                        </div>

                        <button
                          onClick={handleCreateReward}
                          disabled={savingReward || !rewardForm.title.trim()}
                          className="w-full py-3 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50"
                        >
                          {savingReward ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create Reward'}
                        </button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* ── REDEMPTIONS ────────────────────────────────────── */}
            {tab === 'redemptions' && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Redemption History <span className="text-gray-400 font-normal">({totalRedemptions})</span>
                </p>
                {redemptions.length === 0 ? (
                  <div className="text-center py-8">
                    <Package className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">No redemptions yet</p>
                  </div>
                ) : (
                  redemptions.map(r => (
                    <div key={r.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
                      <QrCode className="w-5 h-5 text-purple-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {r.reward?.title || 'Reward'}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {new Date(r.created_at).toLocaleDateString()} · {r.status}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── REVIEWS ──────────────────────────────────────── */}
            {tab === 'reviews' && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Reviews <span className="text-gray-400 font-normal">({reviews.length})</span>
                </p>
                {reviews.length === 0 ? (
                  <div className="text-center py-8">
                    <MessageSquare className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">No reviews yet</p>
                  </div>
                ) : (
                  reviews.map(r => (
                    <div key={r.id} className="glass-card p-4 rounded-2xl">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-secondary-400 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                          {r.user?.full_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{r.user?.full_name || 'User'}</p>
                          <p className="text-[10px] text-gray-400">{new Date(r.created_at).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`w-3 h-3 ${i < r.rating ? 'text-amber-400' : 'text-gray-200 dark:text-gray-700'}`}
                              fill={i < r.rating ? 'currentColor' : 'none'}
                            />
                          ))}
                        </div>
                      </div>
                      {r.comment && <p className="text-xs text-gray-600 dark:text-gray-400">{r.comment}</p>}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── SPONSOR ──────────────────────────────────────── */}
            {tab === 'sponsor' && (
              <div className="space-y-4">
                <div className="text-center">
                  <Crown className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Sponsor Your Merchant</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Boost map visibility and attract more eco-walkers
                  </p>
                </div>

                <div className="space-y-3">
                  {SPONSOR_TIERS.map(tier => {
                    const isCurrent = merchant.sponsor_tier === tier.key;
                    const isDowngrade = (SPONSOR_TIERS.findIndex(t => t.key === tier.key)) <= (SPONSOR_TIERS.findIndex(t => t.key === merchant.sponsor_tier));

                    return (
                      <div
                        key={tier.key}
                        className={`glass-card p-4 rounded-2xl border-2 transition ${
                          isCurrent
                            ? 'border-primary-500 dark:border-primary-400'
                            : 'border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <tier.icon className={`w-6 h-6 ${tier.color}`} />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-900 dark:text-white">{tier.label}</span>
                                {tier.badge && <span className="text-xs">{tier.badge}</span>}
                                {isCurrent && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400 font-medium">
                                    Current
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{tier.desc}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            {tier.cost > 0 ? (
                              <>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">{tier.cost.toLocaleString()}</p>
                                <p className="text-[10px] text-gray-400">pts/month</p>
                              </>
                            ) : (
                              <p className="text-xs text-gray-400">Free</p>
                            )}
                          </div>
                        </div>

                        {!isCurrent && !isDowngrade && tier.cost > 0 && (
                          <button
                            onClick={() => handleUpgrade(tier.key, tier.cost)}
                            disabled={upgrading}
                            className="w-full mt-3 py-2 rounded-xl gradient-primary text-white text-xs font-semibold disabled:opacity-50"
                          >
                            {upgrading ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : `Upgrade for ${tier.cost} pts`}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof Star; color: string }) {
  return (
    <div className="glass-card p-4 rounded-2xl">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}
