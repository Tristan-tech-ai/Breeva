export interface Point { x: number; y: number }

const S = 200;
const PAD = 22;

const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 0 });

/** Predicted (y) against measured (x) with the 1:1 line: dots on the line are perfect guesses. */
export default function ScatterChart({
  points, title, xLabel, yLabel, className,
}: {
  points: Point[];
  title: string;
  xLabel: string;
  yLabel: string;
  className?: string;
}) {
  const vals = points.flatMap((p) => [p.x, p.y]).filter(Number.isFinite);
  const hi = vals.length ? Math.max(...vals) * 1.05 : 1;
  const sx = (v: number) => PAD + (v / hi) * (S - PAD - 6);
  const sy = (v: number) => S - PAD - (v / hi) * (S - PAD - 6);
  return (
    <figure className={`m-0 ${className ?? ''}`} data-viz="scatter">
      <figcaption className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">{title}</figcaption>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[18rem] h-auto" role="img" aria-label={title}>
        <line x1={sx(0)} y1={sy(0)} x2={sx(hi)} y2={sy(hi)} stroke="#94a3b8" strokeDasharray="3 3" />
        <line x1={PAD} y1={S - PAD} x2={S - 6} y2={S - PAD} stroke="currentColor" className="text-gray-300 dark:text-gray-600" />
        <line x1={PAD} y1={6} x2={PAD} y2={S - PAD} stroke="currentColor" className="text-gray-300 dark:text-gray-600" />
        {points.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="3" fill="#059669" fillOpacity="0.65" />
        ))}
        <text x={S - 6} y={S - 6} textAnchor="end" fontSize="9" className="fill-gray-500">{xLabel} ({fmt(hi)})</text>
        <text x={4} y={12} fontSize="9" className="fill-gray-500">{yLabel}</text>
      </svg>
    </figure>
  );
}
