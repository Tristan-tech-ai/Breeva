import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Star, MapPin, Phone, Globe, BadgeCheck, Send, Flag, Gift, Clock, Leaf, Instagram } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import RewardRedemptionModal from '../components/features/RewardRedemptionModal';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { tierFor } from '../lib/merchant-tiers';

interface Merchant {
  id: string; name: string; description: string | null; category: string | null; address: string | null;
  phone: string | null; website: string | null; instagram: string | null; whatsapp: string | null;
  logo_url: string | null; cover_image_url: string | null; is_verified: boolean;
  rating: number; review_count: number; sponsor_tier: string; is_eco_certified: boolean; eco_badge: string | null;
  opening_hours: Record<string, string> | null; gallery_urls: string[] | null;
}
interface Review { id: string; user_id: string; rating: number; comment: string | null; created_at: string; owner_reply: string | null; }
interface RewardItem { id: string; title: string; description: string | null; points_required: number; discount_percentage: number | null; remaining_stock: number | null; }

const DAYS: [string, string][] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [redeemReward, setRedeemReward] = useState<RewardItem | null>(null);

  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const loadReviews = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from('reviews').select('id, user_id, rating, comment, created_at, owner_reply').eq('merchant_id', id).order('created_at', { ascending: false }).limit(50);
    setReviews((data || []) as Review[]);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setIsLoading(true);
      const [{ data: m }, { data: revs }, { data: rws }] = await Promise.all([
        supabase.from('merchants').select('*').eq('id', id).single(),
        supabase.from('reviews').select('id, user_id, rating, comment, created_at, owner_reply').eq('merchant_id', id).order('created_at', { ascending: false }).limit(50),
        supabase.from('rewards').select('id, title, description, points_required, discount_percentage, remaining_stock').eq('merchant_id', id).eq('is_active', true).order('points_required', { ascending: true }),
      ]);
      setMerchant(m);
      setReviews((revs || []) as Review[]);
      setRewards((rws || []) as RewardItem[]);
      if (user && revs) {
        const mine = revs.find((r) => r.user_id === user.id);
        if (mine) { setHasReviewed(true); setMyRating(mine.rating); setMyComment(mine.comment || ''); }
      }
      setIsLoading(false);
    })();
  }, [id, user]);

  const handleSubmitReview = async () => {
    if (!user || !id || myRating === 0) return;
    setIsSubmitting(true);
    const payload = { user_id: user.id, merchant_id: id, rating: myRating, comment: myComment.trim() || null };
    if (hasReviewed) {
      await supabase.from('reviews').update({ rating: myRating, comment: payload.comment }).eq('user_id', user.id).eq('merchant_id', id);
    } else {
      await supabase.from('reviews').insert(payload);
    }
    await loadReviews();
    const { data: m } = await supabase.from('merchants').select('rating, review_count').eq('id', id).single();
    if (m) setMerchant((prev) => (prev ? { ...prev, rating: m.rating, review_count: m.review_count } : prev));
    setHasReviewed(true);
    setIsSubmitting(false);
  };

  const handleFlagReview = async (reviewId: string) => {
    if (!user || flaggedIds.has(reviewId)) return;
    if (!confirm('Flag this review as inappropriate?')) return;
    setFlaggedIds((prev) => new Set(prev).add(reviewId));
    await supabase.from('review_flags').insert({ review_id: reviewId, user_id: user.id, reason: 'inappropriate' });
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="gradient-mesh-bg min-h-screen pb-24">
        <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
          <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /><div className="w-32 h-4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /><div className="w-6" />
        </div>
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-5">
          <div className="glass-card p-5 animate-pulse h-40" /><div className="glass-card p-5 animate-pulse h-24" /><div className="glass-card p-5 animate-pulse h-28" />
        </div>
        <BottomNavigation />
      </div>
    );
  }
  if (!merchant) {
    return (
      <div className="gradient-mesh-bg min-h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-gray-500 dark:text-gray-400">Merchant not found</p>
        <button onClick={() => navigate('/merchants')} className="text-primary-500 text-sm font-medium">Back to Merchants</button>
      </div>
    );
  }

  const tier = tierFor(merchant.sponsor_tier);
  const hours = merchant.opening_hours;
  const todayKey = DAYS[(new Date().getDay() + 6) % 7][0]; // JS Sun=0 → our mon-first index

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1"><ChevronLeft className="w-6 h-6" /></button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate max-w-[200px]">{merchant.name}</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-5">
        {/* Merchant Info + cover */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card overflow-hidden">
          {merchant.cover_image_url && (
            <div className="h-32 w-full bg-gray-100 dark:bg-gray-800"><img src={merchant.cover_image_url} alt="" className="w-full h-full object-cover" /></div>
          )}
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-100 to-secondary-100 dark:from-primary-900/30 dark:to-secondary-900/30 flex items-center justify-center text-3xl flex-shrink-0">
                {merchant.logo_url ? <img src={merchant.logo_url} className="w-12 h-12 rounded-xl object-cover" alt="" /> : '🏪'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">{merchant.name}</h2>
                  {merchant.is_verified && <BadgeCheck size={16} className="text-primary-500 flex-shrink-0" />}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{merchant.category || 'General'}</p>
                <div className="flex items-center gap-1 mt-1">
                  {[1, 2, 3, 4, 5].map((s) => <Star key={s} size={14} className={s <= Math.round(merchant.rating) ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} fill={s <= Math.round(merchant.rating) ? 'currentColor' : 'none'} />)}
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">{merchant.rating?.toFixed(1)} ({merchant.review_count})</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {tier.key !== 'free' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                      <tier.icon className="w-3 h-3" /> {tier.label} {tier.badge}
                    </span>
                  )}
                  {merchant.is_eco_certified && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                      <Leaf className="w-3 h-3" /> Eco-certified {merchant.eco_badge || ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {merchant.description && <p className="text-sm text-gray-600 dark:text-gray-300 mt-3">{merchant.description}</p>}
            <div className="mt-3 space-y-1.5">
              {merchant.address && <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"><MapPin size={13} /> <span>{merchant.address}</span></div>}
              {merchant.phone && <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"><Phone size={13} /> <span>{merchant.phone}</span></div>}
              {merchant.instagram && <div className="flex items-center gap-2 text-xs text-pink-500"><Instagram size={13} /> <span>{merchant.instagram}</span></div>}
              {merchant.website && <div className="flex items-center gap-2 text-xs text-primary-500"><Globe size={13} /> <a href={merchant.website} target="_blank" rel="noopener noreferrer" className="truncate">{merchant.website}</a></div>}
            </div>
          </div>
        </motion.div>

        {/* Gallery */}
        {merchant.gallery_urls && merchant.gallery_urls.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {merchant.gallery_urls.map((url, i) => (
              <img key={i} src={url} alt="" className="h-28 w-40 object-cover rounded-xl flex-shrink-0 snap-start" />
            ))}
          </div>
        )}

        {/* Rewards */}
        {rewards.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 px-1 flex items-center gap-1.5"><Gift className="w-4 h-4 text-primary-500" /> Rewards ({rewards.length})</h3>
            <div className="space-y-2">
              {rewards.map((rw) => (
                <div key={rw.id} className="glass-card p-4 flex items-center gap-3">
                  <div className="grid place-items-center w-10 h-10 rounded-xl bg-primary-500/10 shrink-0"><Gift className="w-5 h-5 text-primary-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{rw.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-medium text-primary-500">{rw.points_required} pts</span>
                      {rw.discount_percentage ? <span className="text-[11px] text-gray-400">{rw.discount_percentage}% off</span> : null}
                    </div>
                  </div>
                  <button onClick={() => setRedeemReward(rw)} disabled={!user} className="px-3.5 py-2 rounded-xl gradient-primary text-white text-xs font-semibold disabled:opacity-50 shrink-0">Redeem</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Opening hours */}
        {hours && (
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" /> Opening hours</h3>
            <div className="space-y-1">
              {DAYS.map(([key, label]) => (
                <div key={key} className={`flex items-center justify-between text-xs ${key === todayKey ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                  <span>{label}{key === todayKey ? ' · Today' : ''}</span>
                  <span className="tabular-nums">{hours[key] || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Write Review */}
        {user && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{hasReviewed ? 'Update Your Review' : 'Write a Review'}</h3>
            <div className="flex items-center gap-1.5 mb-3">
              {[1, 2, 3, 4, 5].map((s) => <button key={s} onClick={() => setMyRating(s)}><Star size={24} className={s <= myRating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} fill={s <= myRating ? 'currentColor' : 'none'} /></button>)}
            </div>
            <textarea value={myComment} onChange={(e) => setMyComment(e.target.value)} placeholder="Share your experience..." maxLength={500} rows={3} className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 text-sm text-gray-900 dark:text-white p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500/50" />
            <button onClick={handleSubmitReview} disabled={myRating === 0 || isSubmitting} className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl gradient-primary text-white text-sm font-medium disabled:opacity-50"><Send size={14} />{isSubmitting ? 'Submitting...' : hasReviewed ? 'Update' : 'Submit'}</button>
          </motion.div>
        )}

        {/* Reviews List */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 px-1">Reviews ({reviews.length})</h3>
          {reviews.length === 0 ? (
            <div className="glass-card p-6 text-center"><p className="text-xs text-gray-400 dark:text-gray-500">No reviews yet. Be the first!</p></div>
          ) : (
            <div className="space-y-2">
              {reviews.map((rev, i) => (
                <motion.div key={rev.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.03 }} className={`glass-card p-3.5 ${rev.user_id === user?.id ? 'ring-1 ring-primary-500/30' : ''}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">{[1, 2, 3, 4, 5].map((s) => <Star key={s} size={11} className={s <= rev.rating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} fill={s <= rev.rating ? 'currentColor' : 'none'} />)}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatDate(rev.created_at)}</span>
                      {rev.user_id !== user?.id && <button onClick={() => handleFlagReview(rev.id)} className={`p-1 rounded transition ${flaggedIds.has(rev.id) ? 'text-red-400' : 'text-gray-300 dark:text-gray-600 hover:text-red-400'}`} title={flaggedIds.has(rev.id) ? 'Flagged' : 'Flag review'}><Flag size={11} /></button>}
                    </div>
                  </div>
                  {rev.comment && <p className="text-xs text-gray-600 dark:text-gray-300">{rev.comment}</p>}
                  {rev.user_id === user?.id && <span className="text-[9px] text-primary-500 font-medium mt-1 inline-block">Your review</span>}
                  {rev.owner_reply && (
                    <div className="mt-2 ml-2 pl-3 border-l-2 border-primary-300 dark:border-primary-700">
                      <p className="text-[10px] font-semibold text-primary-600 dark:text-primary-400">Owner reply</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{rev.owner_reply}</p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {redeemReward && (
        <RewardRedemptionModal
          reward={{ id: redeemReward.id, title: redeemReward.title, points_required: redeemReward.points_required, merchant: { name: merchant.name } }}
          onClose={() => setRedeemReward(null)}
          onSuccess={() => { /* balance refreshed inside modal */ }}
        />
      )}

      <BottomNavigation />
    </div>
  );
}
