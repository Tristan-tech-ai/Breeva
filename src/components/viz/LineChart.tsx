export interface Series {
  name: string;
  values: (number | null)[];
  color?: string;
  dashed?: boolean;
}

import { PAD, H, W, lineScale, linePath } from './lineMath';

const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/** Small multi-series line chart with min/max labels and optional reference line (e.g. WHO guideline). */
export default function LineChart({
  series, title, xLabels, reference, min, max, unit, className,
}: {
  series: Series[];
  title: string;
  /** first and last x label, e.g. ['00.00', '23.00'] */
  xLabels?: [string, string];
  reference?: { value: number; label: string };
  min?: number;
  max?: number;
  unit?: string;
  className?: string;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
  if (reference) all.push(reference.value);
  const lo = min ?? Math.min(0, ...all);
  const hi = max ?? (all.length ? Math.max(...all) * 1.08 : 1);
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const sc = lineScale(n, lo, hi);
  return (
    <figure className={`m-0 ${className ?? ''}`} data-viz="line">
      <figcaption className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={title}>
        <line x1={PAD.l} x2={W - PAD.r} y1={sc.y(lo)} y2={sc.y(lo)} stroke="currentColor" className="text-gray-200 dark:text-gray-700" />
        <text x={PAD.l - 4} y={sc.y(hi) + 4} textAnchor="end" fontSize="9" className="fill-gray-500">{fmt(hi)}</text>
        <text x={PAD.l - 4} y={sc.y(lo)} textAnchor="end" fontSize="9" className="fill-gray-500">{fmt(lo)}</text>
        {reference && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={sc.y(reference.value)} y2={sc.y(reference.value)} stroke="#f59e0b" strokeDasharray="3 3" />
            <text x={W - PAD.r} y={sc.y(reference.value) - 3} textAnchor="end" fontSize="9" fill="#b45309">{reference.label}</text>
          </g>
        )}
        {series.map((s, k) => (
          <path key={s.name} d={linePath(s.values, lo, hi)} fill="none" stroke={s.color ?? ['#059669', '#0284c7', '#a855f7'][k % 3]}
            strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinecap="round" strokeLinejoin="round" data-series={s.name} />
        ))}
        {xLabels && (
          <g fontSize="9" className="fill-gray-500">
            <text x={PAD.l} y={H - 4}>{xLabels[0]}</text>
            <text x={W - PAD.r} y={H - 4} textAnchor="end">{xLabels[1]}</text>
          </g>
        )}
      </svg>
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600 dark:text-gray-300">
          {series.map((s, k) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-0.5" style={{ background: s.color ?? ['#059669', '#0284c7', '#a855f7'][k % 3] }} />{s.name}
            </span>
          ))}
          {unit && <span className="ml-auto">{unit}</span>}
        </div>
      )}
    </figure>
  );
}
