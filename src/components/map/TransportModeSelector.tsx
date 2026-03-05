import { motion } from 'framer-motion';
import { Footprints, Bike, Zap, Car } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import { TRANSPORT_MODES } from '../../lib/api';
import type { TransportMode } from '../../types';

const iconMap: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  Footprints,
  Bike,
  Zap,
  Car,
};

export default function TransportModeSelector() {
  const { transportMode, setTransportMode, routes, selectedRoute } = useMapStore();

  const selectedModeInfo = TRANSPORT_MODES.find(m => m.id === transportMode);
  const co2Saved = selectedModeInfo && selectedRoute
    ? ((170 - selectedModeInfo.co2PerKm) * selectedRoute.distance_meters / 1000).toFixed(0)
    : null;

  return (
    <div className="space-y-2">
      {/* Mode selector pills */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {TRANSPORT_MODES.map((mode) => {
          const isActive = transportMode === mode.id;
          const Icon = iconMap[mode.icon] || Footprints;

          return (
            <button
              key={mode.id}
              onClick={() => setTransportMode(mode.id as TransportMode)}
              className={`
                relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
                transition-all duration-200 flex-shrink-0 whitespace-nowrap
                ${isActive
                  ? 'text-white shadow-md'
                  : 'bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm border border-gray-200/30 dark:border-gray-700/20 text-gray-600 dark:text-gray-400 hover:bg-white/80 dark:hover:bg-gray-800/60'
                }
              `}
              style={isActive ? { background: mode.color } : undefined}
            >
              {isActive && (
                <motion.div
                  layoutId="transport-mode-bg"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: mode.color }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" strokeWidth={isActive ? 2.5 : 2} />
                {mode.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Eco comparison bar */}
      {routes.length > 0 && selectedModeInfo && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center justify-between px-3 py-2 rounded-xl text-[10px] bg-primary-50/80 dark:bg-primary-950/30 border border-primary-100/50 dark:border-primary-800/20"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-primary-600 dark:text-primary-400 font-semibold">
              {selectedModeInfo.co2PerKm === 0 ? '🌱 Zero emission!' : `${selectedModeInfo.co2PerKm}g CO₂/km`}
            </span>
          </div>
          {co2Saved && Number(co2Saved) > 0 && (
            <span className="text-primary-500 font-medium">
              Save {co2Saved}g CO₂ vs car
            </span>
          )}
          <div className="flex items-center gap-1">
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              ×{selectedModeInfo.ecoPointsMultiplier} pts
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
