import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';

interface HeatmapCategory {
  key: string;
  label: string;
  icon: React.ElementType;
  data: Record<string, number>;
  /** 4 color stops from lightest to darkest (Tailwind classes for legend) */
  colors: [string, string, string, string];
  /** 4 hex color stops for cells [light, lightDark] */
  hexColors: [string, string, string, string];
  /** Same but for dark mode */
  hexColorsDark: [string, string, string, string];
  /** Hex color for empty cells */
  hexEmpty: string;
  hexEmptyDark: string;
  /** Empty cell color (Tailwind class for legend) */
  empty: string;
  unit: string;
}

interface StreakHeatmapProps {
  categories: HeatmapCategory[];
  /** If not set, auto-fills container width. GitHub shows 52 weeks (1 year). */
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

  // Remove labels that are too close together (< 3 columns apart)
  // This prevents overlapping text when a month only has 1-2 weeks visible at the edges
  const filtered: typeof labels = [];
  for (let i = 0; i < labels.length; i++) {
    const next = labels[i + 1];
    const prev = filtered[filtered.length - 1];
    // Skip if too close to previous kept label
    if (prev && labels[i].col - prev.col < 3) continue;
    // Skip if too close to next label AND this is the first label (edge sliver)
    if (next && next.col - labels[i].col < 3 && filtered.length === 0) continue;
    filtered.push(labels[i]);
  }
  return filtered;
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
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean; ready: boolean }>({ x: 0, y: 0, below: false, ready: false });

  useEffect(() => {
    // Reset ready on anchor change so we measure before showing
    setPos(p => ({ ...p, ready: false }));
    // Use rAF to ensure the DOM is painted before measuring
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const tipW = el.offsetWidth;
      const tipH = el.offsetHeight;

      // Center horizontally on the anchor cell
      let x = anchor.left + anchor.width / 2 - tipW / 2;
      // Clamp to viewport with 8px margin
      x = Math.max(8, Math.min(x, window.innerWidth - tipW - 8));

      // Position above the cell by default; flip below if it would clip the top
      const spaceAbove = anchor.top;
      const below = spaceAbove < tipH + 12;
      const y = below
        ? anchor.top + anchor.width + 6
        : anchor.top - tipH - 6;

      setPos({ x, y, below, ready: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [anchor.top, anchor.left, anchor.width]);

  const formattedDate = formatTooltipDate(date);
  const label = value === 0
    ? `No ${unit} on ${formattedDate}`
    : `${value} ${value === 1 ? unit.replace(/s$/, '') : unit} on ${formattedDate}`;

  // Compute arrow left relative to tooltip
  const arrowLeft = Math.max(8, Math.min(anchor.left + anchor.width / 2 - pos.x - 4, (ref.current?.offsetWidth ?? 100) - 16));

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] pointer-events-none"
      style={{ left: pos.x, top: pos.y, opacity: pos.ready ? 1 : 0, transition: 'opacity 0.1s' }}
    >
      <div className="relative text-white text-[11px] leading-tight font-medium px-3 py-2 rounded-md shadow-xl whitespace-nowrap" style={{ backgroundColor: '#1b1f23' }}>
        {label}
        {/* Arrow */}
        <div
          className="absolute w-0 h-0"
          style={{
            left: arrowLeft,
            ...(pos.below
              ? { top: -4, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '5px solid #1b1f23' }
              : { bottom: -4, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid #1b1f23' }
            ),
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

export default function StreakHeatmap({ categories, weeks: weeksProp }: StreakHeatmapProps) {
  const [activeKey, setActiveKey] = useState(categories[0]?.key || '');
  const [hoveredCell, setHoveredCell] = useState<{ cell: Cell; rect: DOMRect } | null>(null);
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoWeeks, setAutoWeeks] = useState(weeksProp ?? 20);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Auto-calculate weeks to fill container width
  useEffect(() => {
    if (weeksProp != null) return; // manual override
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      // Available width for columns = total width - day label width
      const cols = Math.floor((w - DAY_LABEL_W) / STEP);
      setAutoWeeks(Math.max(8, Math.min(cols, 52))); // cap at 52 weeks (1 year)
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeksProp]);

  const weeks = weeksProp ?? autoWeeks;

  const activeCategory = categories.find(c => c.key === activeKey) || categories[0];

  const grid = useMemo(
    () => buildGrid(activeCategory.data, weeks),
    [activeCategory.data, weeks],
  );

  const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

  const maxVal = useMemo(() => Math.max(1, ...grid.map(c => c.value)), [grid]);
  const totalActivity = useMemo(() => grid.reduce((s, c) => s + c.value, 0), [grid]);
  const activeDays = useMemo(() => grid.filter(c => c.value > 0).length, [grid]);

  const getColor = useCallback((value: number): string => {
    const colors = isDark ? activeCategory.hexColorsDark : activeCategory.hexColors;
    const empty = isDark ? activeCategory.hexEmptyDark : activeCategory.hexEmpty;
    if (value === 0) return empty;
    const intensity = value / maxVal;
    if (intensity > 0.75) return colors[3];
    if (intensity > 0.5) return colors[2];
    if (intensity > 0.25) return colors[1];
    return colors[0];
  }, [maxVal, activeCategory, isDark]);

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
          {activeCategory.unit} in the last {weeks >= 48 ? 'year' : `${weeks} weeks`}
        </span>
        {activeDays > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto tabular-nums">
            {activeDays} active day{activeDays !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Heatmap grid */}
      <div ref={containerRef} className="overflow-x-auto scrollbar-hide">
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
              className="absolute rounded-[3px] cursor-pointer outline-1 outline-offset-[-1px] outline-transparent hover:outline hover:outline-gray-400 dark:hover:outline-gray-500"
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                left: DAY_LABEL_W + cell.col * STEP,
                top: 18 + cell.row * STEP,
                backgroundColor: getColor(cell.value),
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
