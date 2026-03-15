interface MiniSparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

export default function MiniSparkline({ data, color = '#10b981', width = 60, height = 20, className }: MiniSparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) =>
      `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 2) - 1}`
    )
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={`Trend: ${data[data.length - 1] >= data[0] ? 'up' : 'down'}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
