import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

export interface HomeStats {
  questsCompleted: number;
  questsTotal: number;
  rank: number | null;
  loading: boolean;
}

/**
 * Lightweight client-side fetch of the Home dashboard stats — quests done/total +
 * the user's weekly leaderboard rank. Reuses the same tables QuestsPage and
 * LeaderboardPage read (quests / user_quests / leaderboard_weekly); no new
 * serverless function (stays within the Vercel Hobby 12-function cap).
 */
export function useHomeStats(): HomeStats {
  const userId = useAuthStore((s) => s.user?.id);
  const [stats, setStats] = useState<HomeStats>({
    questsCompleted: 0,
    questsTotal: 0,
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
      const [totalRes, doneRes, rankRes] = await Promise.all([
        supabase.from('quests').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase
          .from('user_quests')
          .select('quest_id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_completed', true),
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
        questsTotal: totalRes.count ?? 0,
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
