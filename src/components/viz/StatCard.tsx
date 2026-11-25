import type { ReactNode } from 'react';

/** One headline number with a short label: the first thing a page shows instead of a paragraph. */
export default function StatCard({
  label, value, unit, note, tone = 'neutral', icon, className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  /** one short line under the number, e.g. "dari 24 jam terakhir" */
  note?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  icon?: ReactNode;
  className?: string;
}) {
  const color = { neutral: 'text-gray-900 dark:text-white', good: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-rose-600 dark:text-rose-400' }[tone];
  return (
    <div className={`rounded-2xl bg-white/80 dark:bg-gray-900/70 border border-gray-100 dark:border-gray-800 p-3.5 ${className ?? ''}`} data-viz="stat">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {icon}<span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-2xl font-extrabold tabular-nums leading-none ${color}`}>{value}</span>
        {unit && <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{unit}</span>}
      </div>
      {note && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">{note}</p>}
    </div>
  );
}
