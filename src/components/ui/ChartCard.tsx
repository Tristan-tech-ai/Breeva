import { lazy, Suspense } from 'react';

export interface ChartSeries {
  dataKey: string;
  color?: string;
  name?: string;
}
export interface ChartCardProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: ChartSeries[];
  kind?: 'bar' | 'line' | 'area';
  height?: number;
  /** Format a numeric value for the tooltip, e.g. (v) => `${v} kg`. */
  valueFormatter?: (v: number) => string;
}

// Single lazy recharts boundary for the whole app (Eco-Impact, Year-in-Review, …)
// so recharts stays in ONE code-split chunk.
const LazyChart = lazy(() => import('recharts').then((m) => ({
  default: ({ data, xKey, series, kind = 'bar', valueFormatter }: ChartCardProps) => {
    const fmt = valueFormatter ? { formatter: ((v: number) => [valueFormatter(v), '']) as never } : {};
    const axis = (
      <>
        <m.XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="#9ca3af" tickLine={false} axisLine={false} />
        <m.YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={28} tickLine={false} axisLine={false} />
        <m.Tooltip
          cursor={{ fill: 'rgba(16,185,129,0.06)' }}
          contentStyle={{ fontSize: 11, borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
          {...fmt}
        />
      </>
    );
    if (kind === 'line') {
      return (
        <m.ResponsiveContainer width="100%" height="100%">
          <m.LineChart data={data}>
            {axis}
            {series.map((s) => (
              <m.Line key={s.dataKey} type="monotone" dataKey={s.dataKey} stroke={s.color ?? '#10b981'} strokeWidth={2} dot={{ r: 3 }} name={s.name} />
            ))}
          </m.LineChart>
        </m.ResponsiveContainer>
      );
    }
    if (kind === 'area') {
      return (
        <m.ResponsiveContainer width="100%" height="100%">
          <m.AreaChart data={data}>
            {axis}
            {series.map((s) => (
              <m.Area key={s.dataKey} type="monotone" dataKey={s.dataKey} stroke={s.color ?? '#10b981'} fill={s.color ?? '#10b981'} fillOpacity={0.15} strokeWidth={2} name={s.name} />
            ))}
          </m.AreaChart>
        </m.ResponsiveContainer>
      );
    }
    return (
      <m.ResponsiveContainer width="100%" height="100%">
        <m.BarChart data={data}>
          {axis}
          {series.map((s) => (
            <m.Bar key={s.dataKey} dataKey={s.dataKey} fill={s.color ?? '#10b981'} radius={[4, 4, 0, 0]} name={s.name} />
          ))}
        </m.BarChart>
      </m.ResponsiveContainer>
    );
  },
})));

/** Lazy, themed Recharts wrapper. One import site for the whole app. */
export default function ChartCard({ height = 200, ...props }: ChartCardProps) {
  return (
    <div style={{ height }}>
      <Suspense fallback={<div className="w-full h-full rounded-xl skeleton-shimmer" />}>
        <LazyChart height={height} {...props} />
      </Suspense>
    </div>
  );
}
