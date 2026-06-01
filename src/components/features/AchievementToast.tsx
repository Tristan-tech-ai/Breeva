import toast from 'react-hot-toast';
import IconBadge from './IconBadge';

export interface UnlockedAchievement {
  achievement_id?: string;
  name: string;
  icon: string;
  category?: string;
  points_reward?: number;
}

/** Premium unlock toast. Deduped by achievement_id (same id won't double-fire). */
export function showAchievementToast(a: UnlockedAchievement) {
  toast.custom(
    (t) => (
      <div
        className={`pointer-events-auto flex items-center gap-3 glass-card px-3.5 py-3 shadow-xl border border-primary-200/60 dark:border-primary-800/60 transition-all duration-300 ${
          t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
        style={{ minWidth: 260, maxWidth: 380 }}
      >
        <IconBadge icon={a.icon} category={a.category} unlocked size={40} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400">
            Achievement terbuka!
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-white truncate">{a.name}</div>
        </div>
        {a.points_reward ? (
          <div className="text-xs font-extrabold text-accent-500 shrink-0">+{a.points_reward}</div>
        ) : null}
      </div>
    ),
    { id: a.achievement_id ? `ach-${a.achievement_id}` : undefined, duration: 4000, position: 'top-center' },
  );
}
