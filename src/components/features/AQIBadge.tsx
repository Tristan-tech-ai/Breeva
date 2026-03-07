import { Wind } from 'lucide-react';
import { getAQIColor } from '../map/MapLibreMap';

interface AQIBadgeProps {
  aqi: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  confidence?: number;
}

function getAQILabel(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

function getAQIEmoji(aqi: number): string {
  if (aqi <= 50) return '😊';
  if (aqi <= 100) return '🙂';
  if (aqi <= 150) return '😐';
  if (aqi <= 200) return '😷';
  if (aqi <= 300) return '🤢';
  return '☠️';
}

export default function AQIBadge({ aqi, size = 'md', showLabel = true, confidence }: AQIBadgeProps) {
  const color = getAQIColor(aqi);
  const label = getAQILabel(aqi);
  const emoji = getAQIEmoji(aqi);

  const iconSize = size === 'sm' ? 12 : size === 'md' ? 14 : 18;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-3 py-1.5 text-sm gap-1.5',
    lg: 'px-4 py-2 text-base gap-2',
  };

  return (
    <div
      className={`
        inline-flex items-center rounded-full backdrop-blur-xl
        bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700/30
        shadow-sm
        ${sizeClasses[size]}
      `}
    >
      <Wind size={iconSize} style={{ color }} strokeWidth={2.5} />
      <span className="font-bold text-gray-900 dark:text-white">{aqi}</span>
      {showLabel && (
        <>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span className="font-medium" style={{ color }}>{label}</span>
          <span>{emoji}</span>
        </>
      )}
      {confidence !== undefined && (
        <span className="text-gray-400 dark:text-gray-500 text-[10px] ml-1">
          {confidence >= 0.7 ? '●●●' : confidence >= 0.4 ? '●●○' : '●○○'}
        </span>
      )}
    </div>
  );
}

export { getAQILabel, getAQIEmoji, getAQIColor };
