import { Award, Baby, Coins, Crown, Flame, Gem, Leaf, Medal, Star, TreePine, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Achievement.icon is a string key (see public.achievements) — map to a lucide icon.
const ICONS: Record<string, LucideIcon> = {
  baby: Baby, fire: Flame, star: Star, coins: Coins, leaf: Leaf,
  gem: Gem, medal: Medal, tree: TreePine, award: Award, crown: Crown, trophy: Trophy,
};

const CATEGORY_GRAD: Record<string, string> = {
  milestone: 'from-sky-400 to-sky-600',
  streak: 'from-orange-400 to-rose-500',
  points: 'from-amber-400 to-amber-600',
  eco: 'from-emerald-400 to-green-600',
  distance: 'from-violet-400 to-indigo-600',
};

/** Gradient achievement badge that resolves a string icon key → lucide icon. */
export default function IconBadge({ icon, category, unlocked = true, size = 44, className }: {
  icon: string;
  category?: string;
  unlocked?: boolean;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[icon] ?? Trophy;
  const grad = CATEGORY_GRAD[category ?? ''] ?? 'from-primary-400 to-primary-600';
  return (
    <div
      className={`rounded-2xl flex items-center justify-center shrink-0 ${
        unlocked ? `bg-gradient-to-br ${grad} shadow-sm` : 'bg-gray-100 dark:bg-gray-800'
      } ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <Icon
        className={unlocked ? 'text-white' : 'text-gray-400 dark:text-gray-600'}
        style={{ width: size * 0.5, height: size * 0.5 }}
        strokeWidth={2}
      />
    </div>
  );
}
