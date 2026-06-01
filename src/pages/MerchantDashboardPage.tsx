import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, BadgeCheck, Star, Gift, QrCode, MessageSquare, Crown, Plus, Pencil,
  Trash2, Package, TrendingUp, Loader2, X, ScanLine, Camera, Power, Settings2,
  CheckCircle2, XCircle, Coins, Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { SkeletonList } from '../components/ui/Skeleton';
import { SPONSOR_TIERS, tierFor } from '../lib/merchant-tiers';
import { registerMerchant, verifyRedemption, type VerifyRedemptionResult } from '../lib/api';
import toast from 'react-hot-toast';

const MerchantQrScanner = lazy(() => import('../components/merchant/MerchantQrScanner'));

// Lazy recharts area chart of redemptions per day (mirrors PaparanPage's LazyDoseChart).
const LazyRedemptionChart = lazy(() => import('recharts').then((m) => ({
  default: ({ data }: { data: { d: string; n: number }[] }) => (
    <m.ResponsiveContainer width="100%" height="100%">
      <m.AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
        <defs>
          <linearGradient id="redFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <m.XAxis dataKey="d" tick={{ fontSize: 9 }} stroke="#9ca3af" tickLine={false} axisLine={false} />
        <m.YAxis tick={{ fontSize: 9 }} stroke="#9ca3af" width={22} tickLine={false} axisLine={false} allowDecimals={false} />
        <m.Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.14)' }} />
        <m.Area type="monotone" dataKey="n" stroke="#10b981" fill="url(#redFill)" strokeWidth={2} />
      </m.AreaChart>
    </m.ResponsiveContainer>
  ),
})));

interface MerchantData {
  id: string; name: string; description: string | null; category: string | null; address: string | null;
  lat: number; lng: number; logo_url: string | null; cover_image_url: string | null;
  is_verified: boolean; is_active: boolean; status: string; ai_notes: string | null;
  rating: number; review_count: number; sponsor_tier: string; sponsor_expires_at: string | null;
  priority_boost: number; owner_id: string;
  phone: string | null; website: string | null; instagram: string | null; whatsapp: string | null;
}

interface RewardRow {
  id: string; title: string; description: string | null; points_required: number;
  discount_percentage: number | null; discount_amount: number | null;
  remaining_stock: number | null; total_stock: number | null; valid_until: string; is_active: boolean;
}
interface RedemptionRow { id: string; created_at: string; status: string; points_spent: number | null; reward: { title: string } | null; }
interface ReviewRow { id: string; rating: number; comment: string | null; created_at: string; owner_reply: string | null; user: { full_name: string; avatar_url: string | null } | null; }

const MERCHANT_STATUS: Record<string, { label: string; color: string }> = {
  approved: { label: 'Verified', color: '#22c55e' },
  pending: { label: 'Pending review', color: '#f59e0b' },
  rejected: { label: 'Rejected', color: '#ef4444' },
};

type Tab = 'overview' | 'rewards' | 'verify' | 'redemptions' | 'reviews' | 'sponsor';
const TABS: { key: Tab; label: string; icon: typeof Gift }[] = [
  { key: 'overview', label: 'Overview', icon: TrendingUp },
  { key: 'rewards', label: 'Rewards', icon: Gift },
  { key: 'verify', label: 'Verify', icon: ScanLine },
  { key: 'redemptions', label: 'Redeemed', icon: QrCode },
  { key: 'reviews', label: 'Reviews', icon: MessageSquare },
  { key: 'sponsor', label: 'Sponsor', icon: Crown },
];

const emptyReward = { title: '', description: '', points_required: 100, discount_percentage: 10, total_stock: 50, valid_days: 30 };

// Module-level (not subject to the component purity rule) — needs the current time.
function daysUntil(dateStr: string): number {
  return Math.max(1, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));
}

export default function MerchantDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [merchant, setMerchant] = useState<MerchantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');

  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [totalRedemptions, setTotalRedemptions] = useState(0);

  // Reward form (create + edit)
  const [showRewardForm, setShowRewardForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rewardForm, setRewardForm] = useState(emptyReward);
  const [savingReward, setSavingReward] = useState(false);

  // Verify
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyRedemptionResult | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  // Profile edit
  const [showProfile, setShowProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', category: '', description: '', address: '', phone: '', website: '', instagram: '', whatsapp: '' });

  // Owner reply
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('merchants').select('*').eq('id', id).single();
      if (error || !data) { toast.error('Merchant not found'); navigate('/merchants'); return; }
      if (data.owner_id !== user?.id) { toast.error('Access denied'); navigate('/merchants'); return; }
      setMerchant(data);
      setLoading(false);
    })();
  }, [id, user, navigate]);

  const fetchRewards = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from('rewards').select('*').eq('merchant_id', id).order('created_at', { ascending: false });
    setRewards(data || []);
  }, [id]);

  const fetchRedemptions = useCallback(async () => {
    if (!id) return;
    const { data, count } = await supabase
      .from('redeemed_rewards')
      .select('id, created_at, status, points_spent, reward:rewards(title)', { count: 'exact' })
      .eq('merchant_id', id).order('created_at', { ascending: false }).limit(300);
    setRedemptions((data || []) as unknown as RedemptionRow[]);
    setTotalRedemptions(count || 0);
  }, [id]);

  const fetchReviews = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at, owner_reply, user:users(full_name, avatar_url)')
      .eq('merchant_id', id).order('created_at', { ascending: false }).limit(50);
    setReviews((data || []) as unknown as ReviewRow[]);
  }, [id]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetches are async; setState runs after await, not a synchronous render cascade */
  useEffect(() => {
    if (!merchant) return;
    if (tab === 'reviews') void fetchReviews();
  }, [tab, merchant, fetchReviews]);

  useEffect(() => {
    if (!merchant) return;
    void Promise.all([fetchRewards(), fetchRedemptions()]);
  }, [merchant, fetchRewards, fetchRedemptions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Reward CRUD (owner-checked by RLS mrc_0001) ──────────────────────
  const openCreate = () => { setEditingId(null); setRewardForm(emptyReward); setShowRewardForm(true); };
  const openEdit = (r: RewardRow) => {
    const days = daysUntil(r.valid_until);
    setEditingId(r.id);
    setRewardForm({ title: r.title, description: r.description || '', points_required: r.points_required, discount_percentage: r.discount_percentage || 0, total_stock: r.total_stock || 50, valid_days: days });
    setShowRewardForm(true);
  };

  const handleSaveReward = async () => {
    if (!id || !rewardForm.title.trim()) return;
    setSavingReward(true);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + rewardForm.valid_days);
    const base = {
      title: rewardForm.title.trim(),
      description: rewardForm.description.trim() || null,
      points_required: rewardForm.points_required,
      discount_percentage: rewardForm.discount_percentage,
      valid_until: validUntil.toISOString().split('T')[0],
    };
    let error;
    if (editingId) {
      ({ error } = await supabase.from('rewards').update(base).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('rewards').insert({ ...base, merchant_id: id, total_stock: rewardForm.total_stock, remaining_stock: rewardForm.total_stock, is_active: true }));
    }
    setSavingReward(false);
    if (error) { toast.error(error.message.includes('policy') ? "You don't own this merchant" : 'Failed to save reward'); return; }
    toast.success(editingId ? 'Reward updated' : 'Reward created!');
    setShowRewardForm(false); setEditingId(null); setRewardForm(emptyReward);
    fetchRewards();
  };

  const toggleRewardActive = async (rewardId: string, currentActive: boolean) => {
    const { error } = await supabase.from('rewards').update({ is_active: !currentActive }).eq('id', rewardId);
    if (error) toast.error('Update failed'); else fetchRewards();
  };

  const deleteReward = async (r: RewardRow) => {
    if (!confirm(`Delete "${r.title}"?`)) return;
    const { count } = await supabase.from('redeemed_rewards').select('id', { count: 'exact', head: true }).eq('reward_id', r.id);
    if (count && count > 0) {
      await supabase.from('rewards').update({ is_active: false }).eq('id', r.id);
      toast('Has redemption history → deactivated, not deleted.');
    } else {
      const { error } = await supabase.from('rewards').delete().eq('id', r.id);
      if (error) { toast.error('Delete failed'); return; }
      toast.success('Reward deleted');
    }
    fetchRewards();
  };

  // ── Verify redemption ────────────────────────────────────────────────
  const doVerify = useCallback(async (code: string) => {
    if (!id || !code.trim()) return;
    setVerifying(true); setVerifyResult(null);
    const res = await verifyRedemption(code.trim(), id);
    setVerifyResult(res);
    setVerifying(false);
    if (res.valid) { toast.success('Voucher valid!'); fetchRedemptions(); }
  }, [id, fetchRedemptions]);

  // ── Profile edit ─────────────────────────────────────────────────────
  const openProfile = () => {
    if (!merchant) return;
    setProfileForm({ name: merchant.name, category: merchant.category || '', description: merchant.description || '', address: merchant.address || '', phone: merchant.phone || '', website: merchant.website || '', instagram: merchant.instagram || '', whatsapp: merchant.whatsapp || '' });
    setShowProfile(true);
  };
  const saveProfile = async () => {
    if (!id || !user) return;
    setSavingProfile(true);
    const res = await registerMerchant({ user_id: user.id, merchant_id: id, ...profileForm });
    setSavingProfile(false);
    if (!res.ok) { toast.error(res.error || 'Save failed'); return; }
    toast.success(res.status === 'approved' ? 'Saved & verified' : res.status === 'pending' ? 'Saved — pending review' : 'Saved — needs review');
    setShowProfile(false);
    const { data } = await supabase.from('merchants').select('*').eq('id', id).single();
    if (data) setMerchant(data);
  };

  // ── Owner reply ──────────────────────────────────────────────────────
  const sendReply = async (reviewId: string) => {
    if (!replyText.trim()) return;
    const { error } = await supabase.from('reviews').update({ owner_reply: replyText.trim() }).eq('id', reviewId);
    if (error) { toast.error('Reply failed'); return; }
    setReplyingId(null); setReplyText('');
    fetchReviews();
  };

  const handleUpgrade = async (tierKey: string, cost: number) => {
    if (!id || !user) return;
    setUpgrading(true);
    const { data, error } = await supabase.rpc('upgrade_merchant_sponsor', { p_merchant_id: id, p_user_id: user.id, p_tier: tierKey, p_cost: cost });
    setUpgrading(false);
    if (error) { toast.error(error.message); return; }
    const result = data?.[0] || data;
    if (result?.success) {
      toast.success(result.message);
      const { data: updated } = await supabase.from('merchants').select('*').eq('id', id).single();
      if (updated) setMerchant(updated);
    } else toast.error(result?.message || 'Upgrade failed');
  };

  const analytics = useMemo(() => {
    const byDay = new Map<string, number>();
    const byReward = new Map<string, number>();
    let points = 0;
    for (const r of redemptions) {
      const iso = r.created_at.slice(0, 10);
      byDay.set(iso, (byDay.get(iso) || 0) + 1);
      const t = r.reward?.title || 'Reward';
      byReward.set(t, (byReward.get(t) || 0) + 1);
      points += r.points_spent || 0;
    }
    const chart = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14).map(([iso, n]) => ({ d: iso.slice(5), n }));
    const top = [...byReward.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { chart, top, points };
  }, [redemptions]);

  if (loading) {
    return (
      <div className="gradient-mesh-bg min-h-screen">
        <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1"><ChevronLeft className="w-6 h-6" /></button>
          <h1 className="text-base font-semibold text-gray-900 dark:text-white">Merchant Dashboard</h1>
        </div>
        <div className="px-4 pt-6"><SkeletonList rows={5} /></div>
      </div>
    );
  }
  if (!merchant) return null;
  const currentTier = tierFor(merchant.sponsor_tier);
  const st = MERCHANT_STATUS[merchant.status] || MERCHANT_STATUS.approved;

  return (
    <div className="gradient-mesh-bg min-h-screen pb-8">
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1"><ChevronLeft className="w-6 h-6" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate">{merchant.name}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Dashboard</p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0" style={{ color: st.color, background: `${st.color}1f` }}>
          {merchant.status === 'approved' ? <BadgeCheck className="w-3 h-3" /> : <Clock className="w-3 h-3" />} {st.label}
        </span>
      </div>

      <div className="px-4 pt-3 flex gap-1.5 overflow-x-auto scrollbar-hide">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              tab === t.key ? 'gradient-primary text-white shadow-sm' : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300'}`}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-4 max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>

            {/* OVERVIEW */}
            {tab === 'overview' && (
              <div className="space-y-4">
                {merchant.status === 'rejected' && merchant.ai_notes && (
                  <div className="rounded-2xl p-4 border" style={{ background: '#ef44441a', borderColor: '#ef444433' }}>
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">Listing needs review</p>
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{merchant.ai_notes} — edit your profile to resubmit.</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Rating" value={merchant.rating?.toFixed(1) || '—'} icon={Star} color="text-amber-500" />
                  <StatCard label="Reviews" value={String(merchant.review_count || 0)} icon={MessageSquare} color="text-blue-500" />
                  <StatCard label="Active Rewards" value={String(rewards.filter(r => r.is_active).length)} icon={Gift} color="text-emerald-500" />
                  <StatCard label="Total Redeemed" value={String(totalRedemptions)} icon={QrCode} color="text-purple-500" />
                </div>

                {/* Analytics */}
                <div className="glass-card p-4 rounded-2xl">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Redemptions (14d)</p>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 dark:text-primary-400"><Coins className="w-3.5 h-3.5" />{analytics.points.toLocaleString()} pts</span>
                  </div>
                  {analytics.chart.length > 0 ? (
                    <div className="h-32"><Suspense fallback={<div className="h-full bg-gray-50 dark:bg-gray-800/40 rounded-lg animate-pulse" />}><LazyRedemptionChart data={analytics.chart} /></Suspense></div>
                  ) : <p className="text-xs text-gray-400 py-6 text-center">No redemptions yet</p>}
                  {analytics.top.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Top rewards</p>
                      {analytics.top.map(([title, n]) => (
                        <div key={title} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 dark:text-gray-300 truncate">{title}</span>
                          <span className="text-gray-400 tabular-nums ml-2">{n}×</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Profile + edit */}
                <div className="glass-card p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Profile</p>
                    <button onClick={openProfile} className="inline-flex items-center gap-1 text-xs font-medium text-primary-500"><Settings2 className="w-3.5 h-3.5" /> Edit</button>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{merchant.category || 'General'}</p>
                  {merchant.address && <p className="text-xs text-gray-500 dark:text-gray-400">{merchant.address}</p>}
                  {merchant.description && <p className="text-xs text-gray-500 dark:text-gray-400">{merchant.description}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <currentTier.icon className={`w-4 h-4 ${currentTier.color}`} />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{currentTier.label} sponsor</span>
                    <button onClick={() => setTab('sponsor')} className="text-xs text-primary-500 ml-auto">Upgrade →</button>
                  </div>
                </div>
              </div>
            )}

            {/* REWARDS */}
            {tab === 'rewards' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Your Rewards</p>
                  <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 rounded-lg gradient-primary text-white text-xs font-medium"><Plus className="w-3.5 h-3.5" /> Add</button>
                </div>
                {rewards.length === 0 ? (
                  <div className="text-center py-8"><Gift className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" /><p className="text-sm text-gray-500 dark:text-gray-400">No rewards yet. Create one!</p></div>
                ) : rewards.map(r => (
                  <div key={r.id} className="glass-card p-4 rounded-2xl">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{r.title}</h4>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
                        </div>
                        {r.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{r.description}</p>}
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs font-medium text-primary-500">{r.points_required} pts</span>
                          {r.discount_percentage ? <span className="text-xs text-gray-400">{r.discount_percentage}% off</span> : null}
                          <span className="text-xs text-gray-400">Stock: {r.remaining_stock ?? '∞'}/{r.total_stock ?? '∞'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => toggleRewardActive(r.id, r.is_active)} className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 ${r.is_active ? 'text-emerald-500' : 'text-gray-400'}`} aria-label="Toggle active"><Power className="w-4 h-4" /></button>
                        <button onClick={() => deleteReward(r)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* VERIFY */}
            {tab === 'verify' && (
              <div className="space-y-3">
                <div className="glass-card p-4 rounded-2xl space-y-3">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Verify a voucher</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Enter the customer's voucher code, or scan their QR.</p>
                  <div className="flex gap-2">
                    <input value={verifyCode} onChange={e => setVerifyCode(e.target.value)} placeholder="Voucher code"
                      className="glass-input flex-1 px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 uppercase tracking-wide" />
                    <button onClick={() => doVerify(verifyCode)} disabled={verifying || !verifyCode.trim()} className="px-4 py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50">
                      {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                    </button>
                  </div>
                  {!showScanner ? (
                    <button onClick={() => { setShowScanner(true); setVerifyResult(null); }} className="w-full py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 inline-flex items-center justify-center gap-2"><Camera className="w-4 h-4" /> Scan QR with camera</button>
                  ) : (
                    <Suspense fallback={<div className="h-48 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />}>
                      <MerchantQrScanner onClose={() => setShowScanner(false)} onScan={(t) => { setShowScanner(false); setVerifyCode(t); doVerify(t); }} />
                    </Suspense>
                  )}
                </div>

                {verifyResult && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl p-4 border" style={verifyResult.valid ? { background: '#22c55e14', borderColor: '#22c55e44' } : { background: '#ef444414', borderColor: '#ef444444' }}>
                    {verifyResult.valid ? (
                      <>
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm"><CheckCircle2 className="w-5 h-5" /> Valid — mark fulfilled</div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white mt-2">{verifyResult.reward?.title}</p>
                        {verifyResult.reward?.discount_percentage ? <p className="text-xs text-gray-500 dark:text-gray-400">{verifyResult.reward.discount_percentage}% off</p> : null}
                        {verifyResult.user?.name && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Customer: {verifyResult.user.name}</p>}
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold text-sm"><XCircle className="w-5 h-5" /> {verifyResult.error || 'Invalid voucher'}</div>
                    )}
                  </motion.div>
                )}
              </div>
            )}

            {/* REDEMPTIONS */}
            {tab === 'redemptions' && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Redemption History <span className="text-gray-400 font-normal">({totalRedemptions})</span></p>
                {redemptions.length === 0 ? (
                  <div className="text-center py-8"><Package className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" /><p className="text-sm text-gray-500 dark:text-gray-400">No redemptions yet</p></div>
                ) : redemptions.slice(0, 50).map(r => (
                  <div key={r.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
                    <QrCode className="w-5 h-5 text-purple-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.reward?.title || 'Reward'}</p>
                      <p className="text-[10px] text-gray-400">{new Date(r.created_at).toLocaleDateString()} · {r.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* REVIEWS */}
            {tab === 'reviews' && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Reviews <span className="text-gray-400 font-normal">({reviews.length})</span></p>
                {reviews.length === 0 ? (
                  <div className="text-center py-8"><MessageSquare className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" /><p className="text-sm text-gray-500 dark:text-gray-400">No reviews yet</p></div>
                ) : reviews.map(r => (
                  <div key={r.id} className="glass-card p-4 rounded-2xl">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-secondary-400 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">{r.user?.full_name?.[0]?.toUpperCase() || '?'}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{r.user?.full_name || 'User'}</p>
                        <p className="text-[10px] text-gray-400">{new Date(r.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-0.5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`w-3 h-3 ${i < r.rating ? 'text-amber-400' : 'text-gray-200 dark:text-gray-700'}`} fill={i < r.rating ? 'currentColor' : 'none'} />)}</div>
                    </div>
                    {r.comment && <p className="text-xs text-gray-600 dark:text-gray-400">{r.comment}</p>}
                    {r.owner_reply ? (
                      <div className="mt-2 ml-2 pl-3 border-l-2 border-primary-300 dark:border-primary-700">
                        <p className="text-[10px] font-semibold text-primary-600 dark:text-primary-400">Owner reply</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{r.owner_reply}</p>
                      </div>
                    ) : replyingId === r.id ? (
                      <div className="mt-2 flex gap-2">
                        <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Your reply…" className="glass-input flex-1 px-3 py-2 text-xs text-gray-900 dark:text-white" />
                        <button onClick={() => sendReply(r.id)} className="px-3 py-2 rounded-lg gradient-primary text-white text-xs font-semibold">Send</button>
                      </div>
                    ) : (
                      <button onClick={() => { setReplyingId(r.id); setReplyText(''); }} className="mt-2 text-[11px] font-medium text-primary-500">Reply</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* SPONSOR */}
            {tab === 'sponsor' && (
              <div className="space-y-4">
                <div className="text-center">
                  <Crown className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Sponsor Your Merchant</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Boost map visibility and attract more eco-walkers</p>
                </div>
                <div className="space-y-3">
                  {SPONSOR_TIERS.map(tier => {
                    const isCurrent = merchant.sponsor_tier === tier.key;
                    const isDowngrade = SPONSOR_TIERS.findIndex(t => t.key === tier.key) <= SPONSOR_TIERS.findIndex(t => t.key === merchant.sponsor_tier);
                    return (
                      <div key={tier.key} className={`glass-card p-4 rounded-2xl border-2 transition ${isCurrent ? 'border-primary-500 dark:border-primary-400' : 'border-transparent'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <tier.icon className={`w-6 h-6 ${tier.color}`} />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-900 dark:text-white">{tier.label}</span>
                                {tier.badge && <span className="text-xs">{tier.badge}</span>}
                                {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400 font-medium">Current</span>}
                              </div>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{tier.desc}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            {tier.cost > 0 ? (<><p className="text-sm font-bold text-gray-900 dark:text-white">{tier.cost.toLocaleString()}</p><p className="text-[10px] text-gray-400">pts/month</p></>) : <p className="text-xs text-gray-400">Free</p>}
                          </div>
                        </div>
                        {!isCurrent && !isDowngrade && tier.cost > 0 && (
                          <button onClick={() => handleUpgrade(tier.key, tier.cost)} disabled={upgrading} className="w-full mt-3 py-2 rounded-xl gradient-primary text-white text-xs font-semibold disabled:opacity-50">
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

      {/* Reward create/edit modal */}
      <AnimatePresence>
        {showRewardForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowRewardForm(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">{editingId ? 'Edit Reward' : 'New Reward'}</h3>
                <button onClick={() => setShowRewardForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
              <input type="text" placeholder="Reward title *" value={rewardForm.title} onChange={e => setRewardForm(f => ({ ...f, title: e.target.value }))} className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400" />
              <textarea placeholder="Description" value={rewardForm.description} onChange={e => setRewardForm(f => ({ ...f, description: e.target.value }))} rows={2} className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Points Required"><input type="number" value={rewardForm.points_required} onChange={e => setRewardForm(f => ({ ...f, points_required: +e.target.value }))} min={1} className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white" /></Field>
                <Field label="Discount %"><input type="number" value={rewardForm.discount_percentage} onChange={e => setRewardForm(f => ({ ...f, discount_percentage: +e.target.value }))} min={0} max={100} className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white" /></Field>
                <Field label="Stock"><input type="number" value={rewardForm.total_stock} onChange={e => setRewardForm(f => ({ ...f, total_stock: +e.target.value }))} min={1} disabled={!!editingId} className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white disabled:opacity-50" /></Field>
                <Field label="Valid (days)"><input type="number" value={rewardForm.valid_days} onChange={e => setRewardForm(f => ({ ...f, valid_days: +e.target.value }))} min={1} className="glass-input w-full px-3 py-2 text-sm text-gray-900 dark:text-white" /></Field>
              </div>
              <button onClick={handleSaveReward} disabled={savingReward || !rewardForm.title.trim()} className="w-full py-3 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50">
                {savingReward ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : editingId ? 'Save Changes' : 'Create Reward'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile edit modal */}
      <AnimatePresence>
        {showProfile && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowProfile(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl p-5 space-y-3 shadow-2xl max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Edit Profile</h3>
                <button onClick={() => setShowProfile(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
              <p className="text-[11px] text-gray-400">Material changes (name, category, address) are re-checked before going live.</p>
              {([['name', 'Business name *'], ['category', 'Category'], ['address', 'Address'], ['phone', 'Phone'], ['website', 'Website'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp']] as const).map(([key, label]) => (
                <input key={key} type="text" placeholder={label} value={profileForm[key]} onChange={e => setProfileForm(f => ({ ...f, [key]: e.target.value }))} className="glass-input w-full px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400" />
              ))}
              <textarea placeholder="Description" value={profileForm.description} onChange={e => setProfileForm(f => ({ ...f, description: e.target.value }))} rows={2} className="glass-input w-full px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none" />
              <button onClick={saveProfile} disabled={savingProfile || profileForm.name.trim().length < 3} className="w-full py-3 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50">
                {savingProfile ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Save Profile'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof Star; color: string }) {
  return (
    <div className="glass-card p-4 rounded-2xl">
      <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p></div>
      <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[10px] text-gray-500 uppercase">{label}</label>{children}</div>;
}
