import { motion } from 'framer-motion';

interface Ring {
  label: string;
  value: number;   // current
  max: number;     // target
  color: string;   // tailwind stroke color or hex
}

interface ActivityRingsProps {
  rings: Ring[];
  size?: number;
}

export default function ActivityRings({ rings, size = 120 }: ActivityRingsProps) {
  const strokeWidth = 10;
  const gap = 4;
  const center = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      {rings.map((ring, i) => {
        const radius = center - strokeWidth / 2 - i * (strokeWidth + gap);
        const circumference = 2 * Math.PI * radius;
        const progress = Math.min(ring.value / ring.max, 1);

        return (
          <g key={ring.label}>
            {/* Background track */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="currentColor"
              className="text-gray-200 dark:text-gray-800"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            {/* Progress arc */}
            <motion.circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={ring.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: circumference * (1 - progress) }}
              transition={{ duration: 1.2, delay: i * 0.15, ease: 'easeOut' }}
              transform={`rotate(-90 ${center} ${center})`}
            />
          </g>
        );
      })}
    </svg>
  );
}
