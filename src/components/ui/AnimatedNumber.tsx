import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';
import { formatAngka } from '../../lib/angka';

interface AnimatedNumberProps {
  value: number;
  /** Milliseconds for the count-up animation (default 800) */
  duration?: number;
  /** Number of decimal places (default 0) */
  decimals?: number;
  /** Optional prefix like "+" or "$" */
  prefix?: string;
  /** Optional suffix like " km" or " pts" */
  suffix?: string;
  className?: string;
}

export default function AnimatedNumber({ value, duration = 800, decimals = 0, prefix = '', suffix = '', className }: AnimatedNumberProps) {
  const animated = useAnimatedNumber(value, duration);
  const formatted = decimals > 0 ? formatAngka(animated, decimals, decimals) : formatAngka(Math.round(animated), 0, 0);

  return <span className={className}>{prefix}{formatted}{suffix}</span>;
}
