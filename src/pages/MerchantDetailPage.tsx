import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Star, MapPin, Phone, Globe, BadgeCheck, Send, Flag } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

interface Merchant {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  is_verified: boolean;
  rating: number;
  review_count: number;
}

interface Review {
  id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  user_name?: string;
}

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Review form
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    (async () => {
      setIsLoading(true);
      const [{ data: m }, { data: revs }] = await Promise.all([
        supabase.from('merchants').select('*').eq('id', id).single(),
        supabase
          .from('reviews')
          .select('*')
          .eq('merchant_id', id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      setMerchant(m);
      setReviews(revs || []);

      // Check if user already reviewed
      if (user && revs) {
        const mine = revs.find(r => r.user_id === user.id);
        if (mine) {
          setHasReviewed(true);
          setMyRating(mine.rating);
          setMyComment(mine.comment || '');
        }
      }
      setIsLoading(false);
    })();
  }, [id, user]);

  const handleSubmitReview = async () => {
    if (!user || !id || myRating === 0) return;
    setIsSubmitting(true);

    const payload = {
      user_id: user.id,
      merchant_id: id,
      rating: myRating,
      comment: myComment.trim() || null,
    };

    if (hasReviewed) {
      await supabase
        .from('reviews')
        .update({ rating: myRating, comment: payload.comment })
        .eq('user_id', user.id)
        .eq('merchant_id', id);
    } else {
      await supabase.from('reviews').insert(payload);
    }

    // Refresh reviews
    const { data: revs } = await supabase
      .from('reviews')
      .select('*')
      .eq('merchant_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    setReviews(revs || []);

    // Refresh merchant rating
    const { data: m } = await supabase.from('merchants').select('rating, review_count').eq('id', id).single();
    if (m && merchant) setMerchant({ ...merchant, rating: m.rating, review_count: m.review_count });

    setHasReviewed(true);
    setIsSubmitting(false);
  };

  const handleFlagReview = async (reviewId: string) => {
    if (!user || flaggedIds.has(reviewId)) return;
    if (!confirm('Flag this review as inappropriate?')) return;
    setFlaggedIds(prev => new Set(prev).add(reviewId));
    await supabase.from('review_flags').insert({
      review_id: reviewId,
      user_id: user.id,
      reason: 'inappropriate',
    });
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="gradient-mesh-bg min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin" />
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

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate max-w-[200px]">{merchant.name}</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-5">
        {/* Merchant Info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-100 to-secondary-100 dark:from-primary-900/30 dark:to-secondary-900/30 flex items-center justify-center text-3xl flex-shrink-0">
              {merchant.logo_url ? (
                <img src={merchant.logo_url} className="w-12 h-12 rounded-xl object-cover" alt="" />
              ) : '🏪'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{merchant.name}</h2>
                {merchant.is_verified && <BadgeCheck size={16} className="text-primary-500 flex-shrink-0" />}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{merchant.category || 'General'}</p>
              <div className="flex items-center gap-1 mt-1">
                {[1, 2, 3, 4, 5].map(s => (
                  <Star key={s} size={14} className={s <= Math.round(merchant.rating) ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} fill={s <= Math.round(merchant.rating) ? 'currentColor' : 'none'} />
                ))}
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">{merchant.rating?.toFixed(1)} ({merchant.review_count})</span>
              </div>
            </div>
          </div>

          {merchant.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-3">{merchant.description}</p>
          )}

          <div className="mt-3 space-y-1.5">
            {merchant.address && (
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <MapPin size={13} /> <span>{merchant.address}</span>
              </div>
            )}
            {merchant.phone && (
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Phone size={13} /> <span>{merchant.phone}</span>
              </div>
            )}
            {merchant.website && (
              <div className="flex items-center gap-2 text-xs text-primary-500">
                <Globe size={13} /> <a href={merchant.website} target="_blank" rel="noopener noreferrer">{merchant.website}</a>
              </div>
            )}
          </div>
        </motion.div>

        {/* Write Review */}
        {user && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              {hasReviewed ? 'Update Your Review' : 'Write a Review'}
            </h3>
            <div className="flex items-center gap-1.5 mb-3">
              {[1, 2, 3, 4, 5].map(s => (
                <button key={s} onClick={() => setMyRating(s)}>
                  <Star size={24} className={s <= myRating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} fill={s <= myRating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            <textarea
              value={myComment}
              onChange={e => setMyComment(e.target.value)}
              placeholder="Share your experience..."
              maxLength={500}
              rows={3}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 text-sm text-gray-900 dark:text-white p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
            <button
              onClick={handleSubmitReview}
              disabled={myRating === 0 || isSubmitting}
              className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl gradient-primary text-white text-sm font-medium disabled:opacity-50"
            >
              <Send size={14} />
              {isSubmitting ? 'Submitting...' : hasReviewed ? 'Update' : 'Submit'}
            </button>
          </motion.div>
        )}

        {/* Reviews List */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 px-1">
            Reviews ({reviews.length})
          </h3>
          {reviews.length === 0 ? (
            <div className="glass-card p-6 text-center">
              <p className="text-xs text-gray-400 dark:text-gray-500">No reviews yet. Be the first!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reviews.map((rev, i) => (
                <motion.div
                  key={rev.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.03 }}
                  className={`glass-card p-3.5 ${rev.user_id === user?.id ? 'ring-1 ring-primary-500/30' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star key={s} size={11} className={s <= rev.rating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} fill={s <= rev.rating ? 'currentColor' : 'none'} />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatDate(rev.created_at)}</span>
                      {rev.user_id !== user?.id && (
                        <button
                          onClick={() => handleFlagReview(rev.id)}
                          className={`p-1 rounded transition ${flaggedIds.has(rev.id) ? 'text-red-400' : 'text-gray-300 dark:text-gray-600 hover:text-red-400'}`}
                          title={flaggedIds.has(rev.id) ? 'Flagged' : 'Flag review'}
                        >
                          <Flag size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  {rev.comment && (
                    <p className="text-xs text-gray-600 dark:text-gray-300">{rev.comment}</p>
                  )}
                  {rev.user_id === user?.id && (
                    <span className="text-[9px] text-primary-500 font-medium mt-1 inline-block">Your review</span>
                  )}
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
