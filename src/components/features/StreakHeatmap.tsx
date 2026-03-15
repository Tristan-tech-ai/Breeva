import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface StreakHeatmapProps {
  /** Map of ISO date string (YYYY-MM-DD) → walk count or distance */
  data: Record<string, number>;
  /** Number of weeks to show (default: 12) */
  weeks?: number;
}

const DAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export default function StreakHeatmap({ data, weeks = 12 }: StreakHeatmapProps) {
  const grid = useMemo(() => {
    const today = new Date();
    const cells: { date: string; value: number; col: number; row: number }[] = [];

    // Start from `weeks` weeks ago, aligned to Monday
    const start = new Date(today);
    start.setDate(start.getDate() - (weeks * 7) + 1);
    // Align to Monday
    const day = start.getDay();
    start.setDate(start.getDate() - ((day + 6) % 7));

    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        if (date > today) continue;
        const key = date.toISOString().split('T')[0];
        cells.push({ date: key, value: data[key] || 0, col: w, row: d });
      }
    }
    return cells;
  }, [data, weeks]);

  const maxVal = useMemo(() => Math.max(1, ...grid.map(c => c.value)), [grid]);

  const getColor = (value: number) => {
    if (value === 0) return 'bg-gray-100 dark:bg-gray-800';
    const intensity = value / maxVal;
    if (intensity > 0.75) return 'bg-emerald-500';
    if (intensity > 0.5) return 'bg-emerald-400';
    if (intensity > 0.25) return 'bg-emerald-300 dark:bg-emerald-600';
    return 'bg-emerald-200 dark:bg-emerald-700';
  };

  return (
    <div>
      <div className="flex gap-[3px]">
        {/* Day labels */}
        <div className="flex flex-col gap-[3px] mr-1">
          {DAYS.map((label, i) => (
            <div key={i} className="h-[12px] flex items-center">
              <span className="text-[8px] text-gray-400 dark:text-gray-500 w-4">{label}</span>
            </div>
          ))}
        </div>
        {/* Grid columns (weeks) */}
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, d) => {
              const cell = grid.find(c => c.col === w && c.row === d);
              if (!cell) return <div key={d} className="w-[12px] h-[12px]" />;
              return (
                <motion.div
                  key={d}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: (w * 7 + d) * 0.003 }}
                  className={`w-[12px] h-[12px] rounded-[2px] ${getColor(cell.value)}`}
                  title={`${cell.date}: ${cell.value} walk${cell.value !== 1 ? 's' : ''}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-1 mt-2 justify-end">
        <span className="text-[8px] text-gray-400">Less</span>
        {['bg-gray-100 dark:bg-gray-800', 'bg-emerald-200 dark:bg-emerald-700', 'bg-emerald-300 dark:bg-emerald-600', 'bg-emerald-400', 'bg-emerald-500'].map((c, i) => (
          <div key={i} className={`w-[10px] h-[10px] rounded-[2px] ${c}`} />
        ))}
        <span className="text-[8px] text-gray-400">More</span>
      </div>
    </div>
  );
}
