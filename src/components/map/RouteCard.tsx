import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Route as RouteIcon, Wind, Star, Leaf, Zap, Scale, Check, TreePine, Car } from 'lucide-react';
import type { Route } from '../../types';
import { getAQIColor } from './LeafletMap';
import RouteForecastBadge from './RouteForecastBadge';
import { computeDose, computeTrapDose, type UserExposureProfile } from '../../lib/exposure';
import { useDistanceUnit, type DistanceUnit } from '../../stores/settingsStore';

// At-a-glance teaser uses a default adult-walker; the /paparan page lets users customize age/mode/health.
const TEASER_PROFILE: UserExposureProfile = { age_bucket: 'adult', mode: 'walk_slow', health_sensitive: false };

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
  const mins = Math.max(1, Math.ceil(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function formatDistance(meters: number, unit: DistanceUnit = 'km'): string {
  if (unit === 'miles') {
    const mi = meters / 1609.344;
    if (mi < 0.1) return `${Math.round(meters / 0.3048)}ft`;
    return `${mi.toFixed(1)}mi`;
  }
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
  const distanceUnit = useDistanceUnit();
  const traffic = route.traffic_level ? trafficConfig[route.traffic_level] : null;
  const [showDetail, setShowDetail] = useState(false);
  const segs = route.vayu_score?.segments;
  // Layer 3 teaser: total inhaled dose (absolute, incl. background) — shown as honest context in detail.
  const exposure = segs?.length ? computeDose(segs, route.duration_seconds, TEASER_PROFILE) : null;
  // The differentiator: dose of the AVOIDABLE traffic increment (NO₂-dominant). A cleaner route lowers this.
  const trapDose = segs?.length ? computeTrapDose(segs, route.duration_seconds, TEASER_PROFILE) : null;
  const trapReduction = route.vayu_trap_reduction_pct;
  // The 2 worst traffic (NO₂) segments — the busy roads this route does/doesn't take.
  const worstNo2 = [...(segs ?? [])]
    .filter((s) => (s.no2_delta ?? 0) > 0)
    .sort((a, b) => (b.no2_delta ?? 0) - (a.no2_delta ?? 0))
    .slice(0, 2);

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
            {formatDistance(route.distance_meters, distanceUnit)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Wind className="w-3.5 h-3.5" style={{ color: getAQIColor(route.vayu_avg_aqi ?? route.avg_aqi) }} />
          <span className="text-sm font-medium" style={{ color: getAQIColor(route.vayu_avg_aqi ?? route.avg_aqi) }}>
            {getAQILabel(route.vayu_avg_aqi ?? route.avg_aqi)}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full border border-amber-200/50 dark:border-amber-700/30">
          <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
          <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
            +{route.eco_points_earned}
          </span>
        </div>
      </div>

      {/* v2 — calibrated estimate + uncertainty range + confidence ("estimasi vs presisi") */}
      {typeof route.vayu_avg_aqi === 'number' && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 font-medium">
            estimasi AQI {Math.round(route.vayu_avg_aqi)}
          </span>
          {typeof route.vayu_min_aqi === 'number' && typeof route.vayu_score?.max_aqi === 'number'
            && route.vayu_score.max_aqi > route.vayu_min_aqi && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              rentang {Math.round(route.vayu_min_aqi)}–{Math.round(route.vayu_score.max_aqi)}
            </span>
          )}
          {typeof route.aqi_confidence === 'number' && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              · keyakinan {route.aqi_confidence >= 70 ? 'tinggi' : route.aqi_confidence >= 40 ? 'sedang' : 'rendah'}
            </span>
          )}
        </div>
      )}

      {/* Layer 3 — TRAFFIC exposure differentiator (the avoidable part). Collapsed = traffic µg + how
          much cleaner vs the fastest; "Lihat detail" reveals the NO₂ hotspots + the honest total air. */}
      {trapDose && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
            <Wind className="w-3 h-3 text-sky-500" />
            <span className="text-gray-600 dark:text-gray-300">
              Paparan lalu lintas ≈ <b className="text-gray-800 dark:text-gray-200">{Math.round(trapDose.dose_ug)} µg</b>
            </span>
            {typeof trapReduction === 'number' && trapReduction >= 3 && (
              <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold">
                −{trapReduction}% vs tercepat
              </span>
            )}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setShowDetail((v) => !v); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setShowDetail((v) => !v); } }}
              className="ml-auto text-sky-600 dark:text-sky-400 font-medium cursor-pointer hover:underline"
            >
              {showDetail ? 'Sembunyikan ▴' : 'Lihat detail ▾'}
            </span>
          </div>

          {showDetail && (
            <div className="mt-2 space-y-1 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2">
              {worstNo2.length > 0 && (
                <div>
                  <span className="font-semibold text-gray-600 dark:text-gray-300">Jalan tersibuk (NO₂): </span>
                  {worstNo2.map((s, i) => (
                    <span key={i}>{i > 0 ? ', ' : ''}{s.name || s.highway} (+{Math.round(s.no2_delta ?? 0)})</span>
                  ))}
                </div>
              )}
              {exposure && (
                <div>
                  <span className="font-semibold text-gray-600 dark:text-gray-300">Total udara (termasuk latar): </span>
                  AQI {Math.round(route.vayu_avg_aqi ?? route.avg_aqi)} · {Math.round(exposure.dose_ug)} µg terhirup · {exposure.cigarette_equiv.toFixed(2)} 🚬 · {exposure.who_24h_ratio.toFixed(1)}× WHO
                </div>
              )}
              <div className="italic opacity-80">
                Latar ~tak terhindarkan; yang bisa dihindari = paparan lalu lintas (angka atas).
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Tier 2 M2 — forecast badge */}
      {route.forecast_summary && Math.abs(route.forecast_summary.delta_pct) >= 15 && (
        <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800/50">
          <RouteForecastBadge
            forecastSummary={route.forecast_summary}
            baseAqi={route.vayu_avg_aqi ?? route.avg_aqi}
          />
        </div>
      )}
    </motion.button>
  );
}
