/**
 * Tier 2 M2 — Per-route temporal forecast badge.
 *
 * Renders when forecast_summary.delta_pct is significant (>15% in either
 * direction). Tells the user "AQI rises to X by Y:00" so they can decide to
 * leave now or wait.
 */
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  forecastSummary?: {
    max_aqi: number;
    max_at_offset_s: number;
    delta_pct: number;
  } | null;
  baseAqi: number;
}

function formatOffset(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `dalam ${min} menit`;
  return `dalam ${Math.floor(min / 60)}j ${min % 60}m`;
}

export default function RouteForecastBadge({ forecastSummary }: Props) {
  if (!forecastSummary || Math.abs(forecastSummary.delta_pct) < 15) return null;

  const isWorse = forecastSummary.delta_pct > 0;
  const Icon = isWorse ? TrendingUp : TrendingDown;
  const tone = isWorse
    ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800/50'
    : 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800/50';

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${tone}`}
    >
      <Icon className="w-3 h-3" />
      <span>
        AQI {isWorse ? 'naik ke' : 'turun ke'} {forecastSummary.max_aqi}
      </span>
      <Clock className="w-3 h-3 opacity-70" />
      <span className="opacity-70">{formatOffset(forecastSummary.max_at_offset_s)}</span>
    </motion.div>
  );
}
