import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';

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

const CELL_SIZE = 11;
const GAP = 3;
const STEP = CELL_SIZE + GAP; // 14px per column/row
const DAY_LABEL_W = 30;

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
      // Skip if this is the last column (label would overflow)
      if (w <= weeks - 2) {
        labels.push({ label: MONTHS[m], col: w });
      }
      lastMonth = m;
    }
  }
  return labels;
}

function formatTooltipDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** Fixed-position tooltip rendered via portal so it never clips */
function HeatmapTooltip({ anchor, value, date, unit }: {
  anchor: { top: number; left: number; width: number };
  value: number;
  date: string;
  unit: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean }>({ x: 0, y: 0, below: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tipW = rect.width;
    const tipH = rect.height;

    // Center horizontally on the anchor cell
    let x = anchor.left + anchor.width / 2 - tipW / 2;
    // Clamp to viewport
    x = Math.max(8, Math.min(x, window.innerWidth - tipW - 8));

    // Position above the cell by default; flip below if it would clip the top
    const spaceAbove = anchor.top - 8;
    const below = spaceAbove < tipH + 8;
    const y = below
      ? anchor.top + anchor.width + 6
      : anchor.top - tipH - 6;

    setPos({ x, y, below });
  }, [anchor]);

  const formattedDate = formatTooltipDate(date);
  const label = value === 0
    ? `No ${unit} on ${formattedDate}`
    : `${value} ${value === 1 ? unit.replace(/s$/, '') : unit} on ${formattedDate}`;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] pointer-events-none"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className={`relative bg-[#1b1f23] text-white text-[11px] leading-tight font-medium px-3 py-2 rounded-md shadow-xl whitespace-nowrap ${pos.below ? 'mt-0' : ''}`}>
        {label}
        {/* Arrow */}
        <div
          className="absolute w-0 h-0"
          style={{
            left: Math.max(8, Math.min(anchor.left + anchor.width / 2 - pos.x - 4, 200)),
            ...(pos.below
              ? { top: -4, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: '4px solid #1b1f23' }
              : { bottom: -4, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '4px solid #1b1f23' }
            ),
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

export default function StreakHeatmap({ categories, weeks = 16 }: StreakHeatmapProps) {
  const [activeKey, setActiveKey] = useState(categories[0]?.key || '');
  const [hoveredCell, setHoveredCell] = useState<{ cell: Cell; rect: DOMRect } | null>(null);

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

  const handleCellEnter = (cell: Cell, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredCell({ cell, rect });
  };

  const gridTotalW = DAY_LABEL_W + weeks * STEP;

  return (
    <div>
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

      {/* Summary line */}
      <div className="flex items-baseline gap-1.5 mb-3">
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

      {/* Heatmap grid */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="relative" style={{ width: gridTotalW, minHeight: 7 * STEP + 18 }}>
          {/* Month labels — absolute positioned */}
          {monthLabels.map((m, i) => (
            <span
              key={i}
              className="absolute text-[10px] text-gray-500 dark:text-gray-400 select-none"
              style={{ top: 0, left: DAY_LABEL_W + m.col * STEP }}
            >
              {m.label}
            </span>
          ))}

          {/* Day labels — absolute positioned */}
          {DAY_LABELS.map((label, i) =>
            label ? (
              <span
                key={i}
                className="absolute text-[9px] text-gray-400 dark:text-gray-500 select-none"
                style={{
                  top: 18 + i * STEP + CELL_SIZE / 2,
                  left: 0,
                  transform: 'translateY(-50%)',
                  width: DAY_LABEL_W - 4,
                  textAlign: 'right',
                }}
              >
                {label}
              </span>
            ) : null,
          )}

          {/* Grid cells */}
          {grid.map((cell) => (
            <motion.div
              key={cell.date}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: cell.col * 0.008, duration: 0.2 }}
              className={`absolute rounded-[3px] ${getColor(cell.value)} cursor-pointer outline-1 outline-transparent hover:outline-gray-400 dark:hover:outline-gray-500 outline-offset-[-1px] hover:outline`}
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                left: DAY_LABEL_W + cell.col * STEP,
                top: 18 + cell.row * STEP,
              }}
              onMouseEnter={(e) => handleCellEnter(cell, e)}
              onMouseLeave={() => setHoveredCell(null)}
            />
          ))}
        </div>
      </div>

      {/* Legend row */}
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          Learn how we count {activeCategory.label.toLowerCase()}
        </span>
        <div className="flex items-center gap-[3px]">
          <span className="text-[9px] text-gray-400 dark:text-gray-500 mr-1">Less</span>
          <div style={{ width: CELL_SIZE - 1, height: CELL_SIZE - 1 }} className={`rounded-[2px] ${activeCategory.empty}`} />
          {activeCategory.colors.map((c, i) => (
            <div key={i} style={{ width: CELL_SIZE - 1, height: CELL_SIZE - 1 }} className={`rounded-[2px] ${c}`} />
          ))}
          <span className="text-[9px] text-gray-400 dark:text-gray-500 ml-1">More</span>
        </div>
      </div>

      {/* Tooltip — portal to body, never clipped */}
      {hoveredCell && (
        <HeatmapTooltip
          anchor={{ top: hoveredCell.rect.top, left: hoveredCell.rect.left, width: hoveredCell.rect.width }}
          value={hoveredCell.cell.value}
          date={hoveredCell.cell.date}
          unit={activeCategory.unit}
        />
      )}
    </div>
  );
}

export { type HeatmapCategory };
