import type { ReactNode } from 'react';
import AnimatedNumber from './AnimatedNumber';

/** Compact metric tile: icon + label + (count-up) value + unit. Replaces the
 *  hand-rolled stat grids in Profile / YearInReview / WalkDetail / EcoImpact. */
export default function StatTile({
  icon, label, value, unit, decimals = 0, animate = true, accent, className,
}: {
  icon?: ReactNode;
  label: string;
  value: number | string;
  unit?: string;
  decimals?: number;
  animate?: boolean;
  /** tailwind text color for the icon, e.g. 'text-emerald-500'. */
  accent?: string;
  className?: string;
}) {
  return (
    <div className={`glass-card p-3 ${className ?? ''}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon && <span className={accent ?? 'text-primary-500'}>{icon}</span>}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-extrabold text-gray-900 dark:text-white tabular-nums leading-none">
          {typeof value === 'number' && animate ? <AnimatedNumber value={value} decimals={decimals} /> : value}
        </span>
        {unit && <span className="text-xs text-gray-400 font-medium">{unit}</span>}
      </div>
    </div>
  );
}
