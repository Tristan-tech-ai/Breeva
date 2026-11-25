export interface Bar {
  label: string;
  value: number;
  /** text shown at the end of the bar; defaults to the formatted value */
  valueLabel?: string;
  highlight?: boolean;
  color?: string;
}

const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/** Horizontal bars, longest first as given. Pure markup: no chart library, readable at 320 px. */
export default function BarChart({
  bars, max, title, unit, className,
}: {
  bars: Bar[];
  /** scale end; defaults to the largest value */
  max?: number;
  /** short sentence that says what the chart means; also the accessible name */
  title: string;
  unit?: string;
  className?: string;
}) {
  const top = max ?? Math.max(0, ...bars.map((b) => b.value));
  const pct = (v: number) => (top > 0 ? Math.max(0, Math.min(100, (v / top) * 100)) : 0);
  return (
    <figure className={`m-0 ${className ?? ''}`} data-viz="bars">
      <figcaption className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">{title}</figcaption>
      <ul className="space-y-1.5 list-none p-0 m-0" aria-label={title}>
        {bars.map((b) => (
          <li key={b.label} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-2 text-xs">
            <span className={`truncate ${b.highlight ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`} title={b.label}>{b.label}</span>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 flex-1 overflow-hidden">
                <span
                  className="block h-full rounded-full"
                  data-pct={pct(b.value).toFixed(1)}
                  style={{ width: `${pct(b.value)}%`, background: b.color ?? (b.highlight ? '#059669' : '#94a3b8') }}
                />
              </span>
              <span className="tabular-nums text-gray-700 dark:text-gray-200 shrink-0">{b.valueLabel ?? `${fmt(b.value)}${unit ? ` ${unit}` : ''}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
