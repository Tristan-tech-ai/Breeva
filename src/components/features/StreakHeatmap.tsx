import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface HeatmapCategory {
  key: string;
  label: string;
  icon: React.ElementType;
  data: Record<string, number>;
  colors: [string, string, string, string];
  empty: string;
  unit: string;
}

interface StreakHeatmapProps {
  categories: HeatmapCategory[];
  weeks?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Cell {
  date: string;
  value: number;
  col: number;
  row: number;
}

// ── GitHub-accurate grid builder ──
// GitHub's graph ends on Saturday (row 6) of the current week.
// Sunday = row 0, Mon = row 1, … Sat = row 6.
// The rightmost column is the current (potentially partial) week.
function buildGrid(data: Record<string, number>, weeks: number) {
  const today = new Date();
  const cells: Cell[] = [];

  // End of grid = today. Find the Sunday that starts the last column's week.
  const todayDay = today.getDay(); // 0=Sun
  const lastColSunday = new Date(today);
  lastColSunday.setDate(today.getDate() - todayDay);

  // First column's Sunday
  const firstColSunday = new Date(lastColSunday);
  firstColSunday.setDate(lastColSunday.getDate() - (weeks - 1) * 7);

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(firstColSunday);
      date.setDate(firstColSunday.getDate() + w * 7 + d);
      if (date > today) continue;
      const key = date.toISOString().split('T')[0];
      cells.push({ date: key, value: data[key] || 0, col: w, row: d });
    }
  }
  return cells;
}

// GitHub only shows a month label at the first column where that month appears,
// AND only if there's enough space (≥ 3 columns) before the next label.
function getMonthLabels(weeks: number) {
  const today = new Date();
  const todayDay = today.getDay();
  const lastColSunday = new Date(today);
  lastColSunday.setDate(today.getDate() - todayDay);
  const firstColSunday = new Date(lastColSunday);
  firstColSunday.setDate(lastColSunday.getDate() - (weeks - 1) * 7);

  const raw: { label: string; col: number }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    const d = new Date(firstColSunday);
    d.setDate(firstColSunday.getDate() + w * 7);
    const m = d.getMonth();
    if (m !== lastMonth) {
      raw.push({ label: MONTHS[m], col: w });
      lastMonth = m;
    }
  }

  // Filter out labels that would overlap (need ≥ 3 cols gap, like GitHub)
  const filtered: typeof raw = [];
  for (let i = 0; i < raw.length; i++) {
    if (i === 0) { filtered.push(raw[i]); continue; }
    if (raw[i].col - raw[i - 1].col >= 3) {
      filtered.push(raw[i]);
    }
  }
  return filtered;
}

const CELL = 10;
const GAP = 3;
const STEP = CELL + GAP; // 13px per column/row
const DAY_W = 30; // width reserved for day labels

export default function StreakHeatmap({ categories, weeks = 16 }: StreakHeatmapProps) {
  const [activeKey, setActiveKey] = useState(categories[0]?.key || '');
  const [hoveredCell, setHoveredCell] = useState<Cell | null>(null);

  const activeCategory = categories.find(c => c.key === activeKey) || categories[0];

  const grid = useMemo(() => buildGrid(activeCategory.data, weeks), [activeCategory.data, weeks]);
  const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

  const maxVal = useMemo(() => Math.max(1, ...grid.map(c => c.value)), [grid]);
  const totalActivity = useMemo(() => grid.reduce((s, c) => s + c.value, 0), [grid]);
  const activeDays = useMemo(() => grid.filter(c => c.value > 0).length, [grid]);

  const getColor = useCallback((value: number) => {
    if (value === 0) return activeCategory.empty;
    const r = value / maxVal;
    if (r > 0.75) return activeCategory.colors[3];
    if (r > 0.5) return activeCategory.colors[2];
    if (r > 0.25) return activeCategory.colors[1];
    return activeCategory.colors[0];
  }, [maxVal, activeCategory]);

  // SVG dimensions — GitHub uses SVG, we mirror it
  const svgW = DAY_W + weeks * STEP - GAP;
  const monthRowH = 15;
  const gridH = 7 * STEP - GAP;
  const svgH = monthRowH + gridH;

  // Tooltip position calculated from cell col/row (px-perfect, no getBoundingClientRect)
  const tooltipStyle = useMemo(() => {
    if (!hoveredCell) return null;
    const x = DAY_W + hoveredCell.col * STEP + CELL / 2;
    const y = monthRowH + hoveredCell.row * STEP - 6;
    return { left: x, top: y };
  }, [hoveredCell]);

  return (
    <div className="relative">
      {/* Category tabs */}
      {categories.length > 1 && (
        <div className="flex gap-1.5 mb-4">
          {categories.map(cat => {
            const Icon = cat.icon;
            const active = cat.key === activeKey;
            return (
              <button
                key={cat.key}
                onClick={() => { setActiveKey(cat.key); setHoveredCell(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  active
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 shadow-sm border border-primary-200 dark:border-primary-800'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 border border-transparent'
                }`}
              >
                <Icon size={12} strokeWidth={active ? 2.5 : 2} />
                {cat.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary */}
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{totalActivity}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {activeCategory.unit} in the last {weeks} weeks
        </span>
        {activeDays > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto tabular-nums">
            {activeDays} active day{activeDays !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* SVG Heatmap — pixel-perfect like GitHub */}
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1 relative" style={{ minHeight: svgH + 8 }}>
        <svg
          width={svgW}
          height={svgH}
          className="block"
          role="img"
          aria-label={`${activeCategory.label} activity over ${weeks} weeks`}
        >
          {/* Month labels — absolutely positioned text at exact column x */}
          {monthLabels.map((m, i) => (
            <text
              key={i}
              x={DAY_W + m.col * STEP}
              y={10}
              className="fill-gray-500 dark:fill-gray-400"
              fontSize={10}
              fontFamily="inherit"
            >
              {m.label}
            </text>
          ))}

          {/* Day labels — Sun(0) Mon(1) Tue(2) Wed(3) Thu(4) Fri(5) Sat(6) */}
          {/* GitHub shows Mon(1), Wed(3), Fri(5) */}
          {[1, 3, 5].map(d => (
            <text
              key={d}
              x={DAY_W - 6}
              y={monthRowH + d * STEP + CELL - 1}
              textAnchor="end"
              className="fill-gray-400 dark:fill-gray-500"
              fontSize={9}
              fontFamily="inherit"
            >
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}
            </text>
          ))}

          {/* Grid cells */}
          {grid.map(cell => (
            <rect
              key={`${cell.col}-${cell.row}`}
              x={DAY_W + cell.col * STEP}
              y={monthRowH + cell.row * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              ry={2}
              className={`${getColor(cell.value)} transition-colors`}
              style={{ outline: hoveredCell?.date === cell.date ? '1.5px solid var(--color-gray-400)' : 'none', outlineOffset: '-0.5px' }}
              onMouseEnter={() => setHoveredCell(cell)}
              onMouseLeave={() => setHoveredCell(null)}
            />
          ))}
        </svg>

        {/* Tooltip — HTML overlay for rich styling, positioned by grid math */}
        <AnimatePresence>
          {hoveredCell && tooltipStyle && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.08 }}
              className="absolute z-50 pointer-events-none"
              style={{
                left: tooltipStyle.left,
                top: tooltipStyle.top,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <div className="bg-[#24292f] dark:bg-[#3d444d] text-white text-[11px] leading-tight px-2 py-1.5 rounded-md shadow-lg whitespace-nowrap text-center">
                {hoveredCell.value === 0 ? (
                  <span>No {activeCategory.unit} on {fmtDate(hoveredCell.date)}</span>
                ) : (
                  <>
                    <span className="font-semibold">{hoveredCell.value} {hoveredCell.value === 1 ? activeCategory.unit.replace(/s$/, '') : activeCategory.unit}</span>
                    <span className="text-[#9198a1]"> on {fmtDate(hoveredCell.date)}</span>
                  </>
                )}
              </div>
              {/* Caret triangle */}
              <div className="flex justify-center -mt-[1px]">
                <div
                  className="w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] border-l-transparent border-r-transparent border-t-[#24292f] dark:border-t-[#3d444d]"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Legend — GitHub style: right-aligned with Less/More */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {activeCategory.label} activity
        </span>
        <div className="flex items-center gap-[3px]">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-0.5">Less</span>
          <svg width={CELL} height={CELL}><rect width={CELL} height={CELL} rx={2} className={activeCategory.empty} /></svg>
          {activeCategory.colors.map((c, i) => (
            <svg key={i} width={CELL} height={CELL}><rect width={CELL} height={CELL} rx={2} className={c} /></svg>
          ))}
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-0.5">More</span>
        </div>
      </div>
    </div>
  );
}

function fmtDate(s: string) {
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export { type HeatmapCategory };
