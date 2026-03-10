import { motion } from 'framer-motion';
import { Clock, Route as RouteIcon, Wind, Star, Leaf, Zap, Scale, Check, TreePine, Car } from 'lucide-react';
import type { Route } from '../../types';
import { getAQIColor } from './LeafletMap';

interface RouteCardProps {
  route: Route;
  isSelected: boolean;
  onSelect: () => void;
  isRecommended?: boolean;
}

const routeLabels: Record<string, { label: string; Icon: typeof Zap; desc: string; gradient: string }> = {
  fast: { label: 'Fastest', Icon: Zap, desc: 'Shortest time', gradient: 'from-gray-500 to-gray-600' },
  balanced: { label: 'Balanced', Icon: Scale, desc: 'Best of both', gradient: 'from-blue-500 to-cyan-500' },
  eco: { label: 'Cleanest', Icon: Leaf, desc: 'Best air quality', gradient: 'from-emerald-500 to-green-500' },
};

const trafficConfig: Record<string, { label: string; color: string; emoji: string }> = {
  low: { label: 'Low traffic', color: 'text-emerald-500', emoji: '🚶' },
  moderate: { label: 'Moderate traffic', color: 'text-amber-500', emoji: '🚗' },
  high: { label: 'Heavy traffic', color: 'text-orange-500', emoji: '🚛' },
  'very-high': { label: 'Very heavy traffic', color: 'text-red-500', emoji: '🚧' },
};

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function getAQILabel(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

export default function RouteCard({ route, isSelected, onSelect, isRecommended }: RouteCardProps) {
  const info = routeLabels[route.route_type] || routeLabels.balanced;
  const { Icon } = info;
  const traffic = route.traffic_level ? trafficConfig[route.traffic_level] : null;

  return (
    <motion.button
      onClick={onSelect}
      whileTap={{ scale: 0.98 }}
      className={`
        w-full text-left rounded-2xl p-4 transition-all duration-200 relative overflow-hidden
        bg-white dark:bg-gray-900/70 backdrop-blur-xl border
        ${isSelected
          ? 'border-primary-400/60 shadow-lg shadow-primary-500/10 ring-1 ring-primary-400/20'
          : 'border-gray-200 dark:border-gray-700/40 hover:border-gray-300 dark:hover:border-gray-600 shadow-sm'
        }
      `}
    >
      {/* Recommended badge */}
      {isRecommended && (
        <div className="absolute top-0 right-0">
          <div className={`bg-gradient-to-r ${info.gradient} text-white text-[9px] font-bold px-2.5 py-1 rounded-bl-xl uppercase tracking-wider`}>
            Recommended
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${info.gradient} flex items-center justify-center shadow-sm`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <span className="text-sm font-bold text-gray-900 dark:text-white">{info.label}</span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-2">{info.desc}</span>
        </div>
        {isSelected && (
          <div className="w-6 h-6 rounded-full bg-primary-500 flex items-center justify-center shadow-sm">
            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {formatDuration(route.duration_seconds)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <RouteIcon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {formatDistance(route.distance_meters)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Wind className="w-3.5 h-3.5" style={{ color: getAQIColor(route.avg_aqi) }} />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            AQI {route.avg_aqi} · {getAQILabel(route.avg_aqi)}
          </span>
          {route.aqi_confidence && route.aqi_confidence >= 80 && (
            <span className="text-[9px] text-gray-400 dark:text-gray-500" title={`${route.aqi_confidence}% confidence`}>
              {route.aqi_confidence >= 90 ? '●●●' : '●●○'}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full border border-amber-200/50 dark:border-amber-700/30">
          <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
          <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
            +{route.eco_points_earned}
          </span>
        </div>
      </div>

      {/* Environment info row (traffic + green score + summary) */}
      {(traffic || route.road_summary) && (
        <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800/50 flex items-center gap-3 flex-wrap">
          {traffic && (
            <span className={`flex items-center gap-1 text-[11px] font-medium ${traffic.color}`}>
              <Car className="w-3 h-3" />
              {traffic.label}
            </span>
          )}
          {typeof route.green_score === 'number' && route.green_score > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-500">
              <TreePine className="w-3 h-3" />
              {route.green_score}% green
            </span>
          )}
          {route.road_summary && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 italic ml-auto truncate max-w-[160px]">
              {route.road_summary}
            </span>
          )}
        </div>
      )}
    </motion.button>
  );
}
