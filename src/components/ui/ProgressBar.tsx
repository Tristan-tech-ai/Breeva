import { motion, useReducedMotion } from 'framer-motion';

/** Animated gradient progress bar (reduced-motion safe). `value` is 0–100. */
export default function ProgressBar({ value, className, barClassName, height = 8 }: {
  value: number;
  className?: string;
  barClassName?: string;
  height?: number;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800 ${className ?? ''}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className={`h-full rounded-full gradient-primary ${barClassName ?? ''}`}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={reduce ? undefined : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
