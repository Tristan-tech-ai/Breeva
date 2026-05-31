import { Link } from 'react-router-dom';
import { Target, Flame, Trophy } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useHomeStats } from '../../hooks/useHomeStats';
import { haptic } from '../../lib/haptic';
import AnimatedNumber from '../ui/AnimatedNumber';

/**
 * Home dashboard stat cards — Misi (quests) · Hari beruntun (streak) · Peringkat (rank).
 * Each is a tappable glass card linking to its detail page, with a small progress
 * micro-viz. Replaces the old hardcoded "0/3" / "#--" placeholders with live data.
 */
export default function HomeStatCards() {
  const streak = useAuthStore((s) => s.profile?.current_streak ?? 0);
  const { questsCompleted, questsTotal, rank } = useHomeStats();

  const total = questsTotal || 3;
  const done = Math.min(questsCompleted, total);
  const questPct = total ? (done / total) * 100 : 0;

  const cardBase =
    'group relative flex flex-col rounded-2xl border p-3 text-left transition-transform duration-200 active:scale-[0.97]';

  return (
    <div className="mb-4 grid grid-cols-3 gap-2.5">
      {/* Misi (quests) → /quests */}
      <Link
        to="/quests"
        onClick={() => haptic('light')}
        aria-label={`Misi: ${done} dari ${total} selesai. Buka misi.`}
        className={`${cardBase} border-primary-100/70 bg-primary-50/70 dark:border-primary-800/30 dark:bg-primary-950/30`}
      >
        <span className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary-500/15">
          <Target className="h-4 w-4 text-primary-600 dark:text-primary-400" strokeWidth={2.2} />
        </span>
        <span className="text-[19px] font-extrabold leading-none tabular-nums text-primary-700 dark:text-primary-300">
          <AnimatedNumber value={done} />
          <span className="text-gray-400 dark:text-gray-500">/{total}</span>
        </span>
        <span className="mt-1 text-[10.5px] font-medium text-gray-500 dark:text-gray-400">Misi</span>
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-primary-200/50 dark:bg-primary-900/40">
          <span
            className="block h-full rounded-full bg-primary-500 transition-all duration-500"
            style={{ width: `${questPct}%` }}
          />
        </span>
      </Link>

      {/* Hari beruntun (streak) → /profile */}
      <Link
        to="/profile"
        onClick={() => haptic('light')}
        aria-label={`Hari beruntun: ${streak}. Buka profil.`}
        className={`${cardBase} border-amber-100/70 bg-amber-50/70 dark:border-amber-800/30 dark:bg-amber-950/30`}
      >
        <span className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15">
          <Flame className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={2.2} />
        </span>
        <span className="text-[19px] font-extrabold leading-none tabular-nums text-amber-700 dark:text-amber-300">
          <AnimatedNumber value={streak} />
        </span>
        <span className="mt-1 text-[10.5px] font-medium text-gray-500 dark:text-gray-400">Hari beruntun</span>
        <span className="mt-1.5 flex gap-0.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${
                i < Math.min(streak, 7) ? 'bg-amber-500' : 'bg-amber-200/60 dark:bg-amber-900/40'
              }`}
            />
          ))}
        </span>
      </Link>

      {/* Peringkat (rank) → /leaderboard */}
      <Link
        to="/leaderboard"
        onClick={() => haptic('light')}
        aria-label={rank ? `Peringkat #${rank} minggu ini. Buka papan peringkat.` : 'Peringkat belum ada. Buka papan peringkat.'}
        className={`${cardBase} border-violet-100/70 bg-violet-50/70 dark:border-violet-800/30 dark:bg-violet-950/30`}
      >
        <span className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15">
          <Trophy className="h-4 w-4 text-violet-600 dark:text-violet-400" strokeWidth={2.2} />
        </span>
        <span className="text-[19px] font-extrabold leading-none tabular-nums text-violet-700 dark:text-violet-300">
          {rank ? <AnimatedNumber value={rank} prefix="#" /> : '—'}
        </span>
        <span className="mt-1 text-[10.5px] font-medium text-gray-500 dark:text-gray-400">Peringkat</span>
        <span className="mt-1.5 text-[9px] font-semibold text-violet-500/80 dark:text-violet-400/80">
          {rank ? 'minggu ini' : 'Mulai jalan!'}
        </span>
      </Link>
    </div>
  );
}
