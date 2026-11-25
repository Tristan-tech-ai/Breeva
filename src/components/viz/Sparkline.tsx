/** Tiny trend line with the latest point marked; used inside cards (e.g. 24 hours of one road). */
export default function Sparkline({
  values, label, color = '#059669', width = 96, height = 28, className,
}: {
  values: (number | null)[];
  /** accessible name, e.g. "Asap kendaraan 24 jam ke depan" */
  label: string;
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const ok = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null && Number.isFinite(p[1]));
  if (ok.length < 2) return null;
  const lo = Math.min(...ok.map((p) => p[1]));
  const hi = Math.max(...ok.map((p) => p[1]));
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - lo) / span) * (height - 6);
  const d = ok.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = ok[ok.length - 1];
  return (
    <svg width={width} height={height} className={className} role="img" aria-label={label} data-viz="spark">
      <path d={`${d}L${x(last[0]).toFixed(1)},${height - 1}L${x(ok[0][0]).toFixed(1)},${height - 1}Z`} fill={color} fillOpacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r="2.2" fill={color} />
    </svg>
  );
}
