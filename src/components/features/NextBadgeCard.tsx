import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { co2KgFromGrams } from '../../lib/metrics';
import IconBadge from './IconBadge';
import ProgressBar from '../ui/ProgressBar';

interface ProgressRow {
  achievement_id: string;
  name: string;
  icon: string;
  category: string;
  requirement_type: string;
  requirement_value: number;
  points_reward: number;
  is_unlocked: boolean;
  current_value: number;
  remaining: number;
  progress_pct: number;
}

function remainingLabel(r: ProgressRow): string {
  switch (r.requirement_type) {
    case 'total_distance': return `${(r.remaining / 1000).toFixed(1)} km lagi`;
    case 'co2_saved': return `${co2KgFromGrams(r.remaining).toFixed(1)} kg CO₂ lagi`;
    case 'walks': return `${r.remaining} jalan lagi`;
    case 'streak': return `${r.remaining} hari beruntun lagi`;
    case 'total_points': return `${r.remaining} poin lagi`;
    default: return `${r.remaining} lagi`;
  }
}

/** "Next badge" nudge — the closest-to-unlock achievement with a progress bar.
 *  Powered by the get_achievement_progress RPC (migration_gam_0012). */
export default function NextBadgeCard({ className }: { className?: string }) {
  const user = useAuthStore((s) => s.user);
  const [row, setRow] = useState<ProgressRow | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase.rpc('get_achievement_progress', { p_user_id: user.id }).then(({ data }) => {
      if (!alive) return;
      const locked = ((data ?? []) as ProgressRow[]).filter((r) => !r.is_unlocked && r.remaining > 0);
      locked.sort((a, b) => b.progress_pct - a.progress_pct);
      setRow(locked[0] ?? null);
    });
    return () => { alive = false; };
  }, [user]);

  if (!row) return null;
  return (
    <div className={`glass-card p-4 flex items-center gap-3 ${className ?? ''}`}>
      <IconBadge icon={row.icon} category={row.category} unlocked={false} size={46} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
            <Target className="w-3 h-3" /> Badge berikutnya
          </span>
          <span className="text-[11px] font-extrabold text-accent-500 shrink-0">+{row.points_reward}</span>
        </div>
        <div className="text-sm font-bold text-gray-900 dark:text-white truncate">{row.name}</div>
        <ProgressBar value={row.progress_pct} className="my-1.5" height={6} />
        <div className="text-[11px] text-gray-500 dark:text-gray-400">{remainingLabel(row)}</div>
      </div>
    </div>
  );
}
