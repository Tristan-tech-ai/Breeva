import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface HeatmapCategory {
  key: string;
  label: string;
  icon: React.ElementType;
  data: Record<string, number>;
  /** 4 color stops from lightest to darkest */
  colors: [string, string, string, string];
  /** Empty cell color */
  empty: string;
  unit: string;
}

interface StreakHeatmapProps {
  categories: HeatmapCategory[];
  weeks?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

interface Cell {
  date: string;
  value: number;
  col: number;
  row: number;
}

function buildGrid(data: Record<string, number>, weeks: number) {
  const today = new Date();
  const cells: Cell[] = [];
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7) + 1);
  const dayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayOffset);

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
}

function getMonthLabels(weeks: number) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7) + 1);
  const dayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayOffset);

  const labels: { label: string; col: number }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    const d = new Date(start);
    d.setDate(start.getDate() + w * 7);
    const m = d.getMonth();
    if (m !== lastMonth) {
      labels.push({ label: MONTHS[m], col: w });
      lastMonth = m;
    }
  }
  return labels;
}

export default function StreakHeatmap({ categories, weeks = 16 }: StreakHeatmapProps) {
  const [activeKey, setActiveKey] = useState(categories[0]?.key || '');
  const [tooltip, setTooltip] = useState<{ date: string; value: number; x: number; y: number } | null>(null);

  const activeCategory = categories.find(c => c.key === activeKey) || categories[0];

  const grid = useMemo(
    () => buildGrid(activeCategory.data, weeks),
    [activeCategory.data, weeks],
  );

  const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

  const maxVal = useMemo(() => Math.max(1, ...grid.map(c => c.value)), [grid]);
  const totalActivity = useMemo(() => grid.reduce((s, c) => s + c.value, 0), [grid]);
  const activeDays = useMemo(() => grid.filter(c => c.value > 0).length, [grid]);

  const getColor = useCallback((value: number) => {
    if (value === 0) return activeCategory.empty;
    const intensity = value / maxVal;
    if (intensity > 0.75) return activeCategory.colors[3];
    if (intensity > 0.5) return activeCategory.colors[2];
    if (intensity > 0.25) return activeCategory.colors[1];
    return activeCategory.colors[0];
  }, [maxVal, activeCategory]);

  const cellSize = 11;
  const gap = 3;
  const dayLabelWidth = 28;
  const gridWidth = weeks * (cellSize + gap);

  const handleCellHover = (cell: Cell, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const container = (e.currentTarget as HTMLElement).closest('[data-heatmap-root]')?.getBoundingClientRect();
    if (!container) return;
    setTooltip({
      date: cell.date,
      value: cell.value,
      x: rect.left - container.left + cellSize / 2,
      y: rect.top - container.top - 4,
    });
  };

  return (
    <div data-heatmap-root className="relative">
      {/* Category tabs */}
      {categories.length > 1 && (
        <div className="flex gap-1.5 mb-4">
          {categories.map(cat => {
            const Icon = cat.icon;
            const isActive = cat.key === activeKey;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveKey(cat.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 shadow-sm border border-primary-200 dark:border-primary-800'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 border border-transparent'
                }`}
              >
                <Icon size={12} strokeWidth={isActive ? 2.5 : 2} />
                {cat.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary line — GitHub style */}
      <div className="flex items-baseline gap-1.5 mb-3">
        <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{totalActivity}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {activeCategory.unit} in the last {weeks} weeks
        </span>
        {activeDays > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
            {activeDays} active day{activeDays !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div style={{ minWidth: dayLabelWidth + gridWidth + 4 }}>
          {/* Month labels row */}
          <div className="flex" style={{ paddingLeft: dayLabelWidth }}>
            {monthLabels.map((m, i) => (
              <span
                key={i}
                className="text-[10px] text-gray-500 dark:text-gray-400 leading-none"
                style={{
                  position: 'relative',
                  left: m.col * (cellSize + gap),
                  marginLeft: i === 0 ? 0 : -(monthLabels[i - 1]?.label.length ?? 0) * 4,
                }}
              >
                {m.label}
              </span>
            ))}
          </div>

          {/* Grid body */}
          <div className="flex mt-1.5">
            {/* Day labels */}
            <div className="flex flex-col" style={{ width: dayLabelWidth, gap }}>
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  style={{ height: cellSize }}
                  className="flex items-center justify-end pr-1.5"
                >
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 leading-none">{label}</span>
                </div>
              ))}
            </div>

            {/* Week columns */}
            <div className="flex" style={{ gap }}>
              {Array.from({ length: weeks }, (_, w) => (
                <div key={w} className="flex flex-col" style={{ gap }}>
                  {Array.from({ length: 7 }, (_, d) => {
                    const cell = grid.find(c => c.col === w && c.row === d);
                    if (!cell) {
                      return <div key={d} style={{ width: cellSize, height: cellSize }} />;
                    }
                    return (
                      <motion.div
                        key={d}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: (w * 7 + d) * 0.002, duration: 0.15 }}
                        style={{ width: cellSize, height: cellSize }}
                        className={`rounded-[3px] ${getColor(cell.value)} cursor-pointer transition-all hover:ring-1 hover:ring-gray-400 dark:hover:ring-gray-500 hover:ring-offset-1 hover:ring-offset-white dark:hover:ring-offset-gray-900`}
                        onMouseEnter={(e) => handleCellHover(cell, e)}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend row */}
      <div className="flex items-center justify-between mt-3">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-primary-500 transition-colors"
        >
          Learn how we count {activeCategory.label.toLowerCase()}
        </a>
        <div className="flex items-center gap-[3px]">
          <span className="text-[9px] text-gray-400 dark:text-gray-500 mr-1">Less</span>
          <div style={{ width: cellSize - 1, height: cellSize - 1 }} className={`rounded-[2px] ${activeCategory.empty}`} />
          {activeCategory.colors.map((c, i) => (
            <div key={i} style={{ width: cellSize - 1, height: cellSize - 1 }} className={`rounded-[2px] ${c}`} />
          ))}
          <span className="text-[9px] text-gray-400 dark:text-gray-500 ml-1">More</span>
        </div>
      </div>

      {/* Tooltip */}
      <AnimatePresence>
        {tooltip && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="absolute z-50 pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
          >
            <div className="bg-gray-900 dark:bg-gray-700 text-white text-[10px] font-medium px-2.5 py-1.5 rounded-md shadow-lg whitespace-nowrap">
              <span className="font-bold">{tooltip.value} {activeCategory.unit}</span>
              <span className="text-gray-300 dark:text-gray-400"> on {formatTooltipDate(tooltip.date)}</span>
            </div>
            <div className="w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45 mx-auto -mt-1" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatTooltipDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export { type HeatmapCategory };
