import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

export interface HomeStats {
  questsCompleted: number;
  questsTotal: number;
  rank: number | null;
  loading: boolean;
}

// WIB (Asia/Jakarta, UTC+7) calendar date — must match the server's quest day.
function wibToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Home dashboard stats — daily quests done (of the 3-daily quota) + the user's
 * weekly leaderboard rank. Ensures today's quests exist (idempotent RPC) then
 * counts today's completions from the per-user generated quest rows. No new
 * serverless function (stays within the Vercel Hobby 12-function cap).
 */
export function useHomeStats(): HomeStats {
  const userId = useAuthStore((s) => s.user?.id);
  const [stats, setStats] = useState<HomeStats>({
    questsCompleted: 0,
    questsTotal: 3,
    rank: null,
    loading: true,
  });

  useEffect(() => {
    if (!userId) {
      setStats((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    (async () => {
      const day = wibToday();
      // Generate today's quests if missing (idempotent, own-user guarded), then count.
      await supabase.rpc('ensure_daily_quests', { p_user_id: userId }).then(() => {}, () => {});
      const [doneRes, rankRes] = await Promise.all([
        supabase
          .from('user_quests')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('quest_date', day)
          .eq('is_completed', true)
          .not('template_id', 'is', null),
        supabase
          .from('leaderboard_weekly')
          .select('rank')
          .eq('user_id', userId)
          .order('week_start', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const rank = (rankRes.data as { rank?: number } | null)?.rank ?? null;
      setStats({
        questsTotal: 3,
        questsCompleted: doneRes.count ?? 0,
        rank: rank && rank > 0 ? rank : null,
        loading: false,
      });
    })().catch(() => {
      if (!cancelled) setStats((s) => ({ ...s, loading: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return stats;
}
