import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { rankThisWeek, wibToday, wibWeekStart } from '../lib/wibWeek';

export interface HomeStats {
  questsCompleted: number;
  questsTotal: number;
  rank: number | null;
  loading: boolean;
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
    if (!userId) return; // signed out: nothing to load (loading is reported false below)
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
          .select('rank, week_start')
          .eq('user_id', userId)
          .eq('week_start', wibWeekStart())
          .maybeSingle(),
      ]);
      if (cancelled) return;
      // Only this WIB week's row counts: an old week's rank must not read as 'minggu ini' (N-57: June's #7 did).
      const rank = rankThisWeek(rankRes.data as { rank?: number; week_start?: string } | null);
      setStats({
        questsTotal: 3,
        questsCompleted: doneRes.count ?? 0,
        rank,
        loading: false,
      });
    })().catch(() => {
      if (!cancelled) setStats((s) => ({ ...s, loading: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return userId ? stats : { ...stats, loading: false };
}
