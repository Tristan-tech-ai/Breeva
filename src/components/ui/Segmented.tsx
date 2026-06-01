import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  Icon?: LucideIcon;
}

/** Sliding-pill segmented control (shared across Leaderboard, SavedPlaces, profile cluster). */
export default function Segmented<T extends string>({
  options, value, onChange, idBase, size = 'md',
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Unique layout id for the sliding pill (must differ per on-screen instance). */
  idBase: string;
  size?: 'md' | 'sm';
}) {
  return (
    <div className="relative flex gap-1 p-1 rounded-2xl bg-gray-100/80 dark:bg-gray-800/60 border border-white/40 dark:border-white/5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors ${
              size === 'sm' ? 'py-1.5 text-[11px]' : 'py-2 text-xs'
            } ${active ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            {active && (
              <motion.span
                layoutId={idBase}
                className="absolute inset-0 -z-10 rounded-xl gradient-primary shadow-md"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            {opt.Icon && <opt.Icon className="w-3.5 h-3.5" strokeWidth={2.4} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
