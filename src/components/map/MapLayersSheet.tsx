import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Map, Satellite, Mountain, Wind, Store,
  TreePine, Activity,
} from 'lucide-react';
import type { AirQualityData, PollutantType } from '../../types';
import { POLLUTANT_OPTIONS, getColorStops } from './RoadPollutionLayer';

interface MapLayersSheetProps {
  isOpen: boolean;
  onClose: () => void;
  mapStyle: 'voyager' | 'osm' | 'satellite';
  onMapStyleChange: (style: 'voyager' | 'osm' | 'satellite') => void;
  showAQIOverlay: boolean;
  onAQIOverlayToggle: () => void;
  showPOIs: boolean;
  onPOIsToggle: () => void;
  currentAQI?: AirQualityData | null;
  pollutant?: PollutantType;
  onPollutantChange?: (p: PollutantType) => void;
}

const mapTypes: { id: 'voyager' | 'osm' | 'satellite'; label: string; icon: typeof Map; preview: string }[] = [
  {
    id: 'voyager',
    label: 'Default',
    icon: Map,
    preview: 'linear-gradient(135deg, #d4ecd4 0%, #e8f5e9 30%, #f1f8e9 60%, #fff 100%)',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    icon: Satellite,
    preview: 'linear-gradient(135deg, #1a3a2a 0%, #2d5a3d 40%, #1a4a2a 100%)',
  },
  {
    id: 'osm',
    label: 'Terrain',
    icon: Mountain,
    preview: 'linear-gradient(135deg, #c8e6c9 0%, #a5d6a7 30%, #dce775 60%, #e8d5b7 100%)',
  },
];

export default function MapLayersSheet({
  isOpen,
  onClose,
  mapStyle,
  onMapStyleChange,
  showAQIOverlay,
  onAQIOverlayToggle,
  showPOIs,
  onPOIsToggle,
  currentAQI,
  pollutant = 'aqi',
  onPollutantChange,
}: MapLayersSheetProps) {
  const activePollutant = POLLUTANT_OPTIONS.find((o) => o.id === pollutant) || POLLUTANT_OPTIONS[0];
  const colorStops = getColorStops(pollutant);

  // Build CSS gradient from color stops
  const gradient = colorStops
    .map((s, i) => `${s.c} ${Math.round((i / (colorStops.length - 1)) * 100)}%`)
    .join(', ');

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl max-h-[80vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                  <TreePine className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Map Layers</h2>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Map Type section */}
            <div className="px-5 pb-4">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                Map Type
              </p>
              <div className="grid grid-cols-3 gap-3">
                {mapTypes.map((type) => {
                  const isActive = mapStyle === type.id;
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.id}
                      onClick={() => onMapStyleChange(type.id)}
                      className={`
                        flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all
                        ${isActive
                          ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20 shadow-sm'
                          : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                        }
                      `}
                    >
                      <div
                        className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center"
                        style={{ background: type.preview }}
                      >
                        <Icon
                          className={`w-6 h-6 ${
                            type.id === 'satellite'
                              ? 'text-green-100'
                              : 'text-primary-600/60'
                          }`}
                          strokeWidth={1.5}
                        />
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          isActive
                            ? 'text-primary-600 dark:text-primary-400'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {type.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="mx-5 h-px bg-gray-100 dark:bg-gray-800" />

            {/* Map Details section */}
            <div className="px-5 pt-4 pb-4">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                Map Details
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* Places toggle */}
                <button
                  onClick={onPOIsToggle}
                  className={`
                    flex flex-col items-start gap-2 p-3.5 rounded-2xl border-2 transition-all text-left
                    ${showPOIs
                      ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                      : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                    }
                  `}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: showPOIs ? '#16a34a18' : undefined }}>
                    <Store className="w-4.5 h-4.5" style={{ color: showPOIs ? '#16a34a' : '#9ca3af' }} />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${showPOIs ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                      Places
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">
                      Nearby restaurants, shops, parks
                    </p>
                  </div>
                </button>

                {/* Road Pollution toggle */}
                <button
                  onClick={onAQIOverlayToggle}
                  className={`
                    flex flex-col items-start gap-2 p-3.5 rounded-2xl border-2 transition-all text-left
                    ${showAQIOverlay
                      ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-900/20'
                      : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                    }
                  `}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: showAQIOverlay ? '#0ea5e918' : undefined }}>
                    <Activity className="w-4.5 h-4.5" style={{ color: showAQIOverlay ? '#0ea5e9' : '#9ca3af' }} />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${showAQIOverlay ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                      Road Pollution
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">
                      {currentAQI ? `AQI ${currentAQI.aqi} — ${currentAQI.level.replace('-', ' ')}` : 'Street-level air quality'}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Road Pollution Panel (eLichens-style) ── */}
            <AnimatePresence>
              {showAQIOverlay && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="mx-5 mb-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 overflow-hidden">
                    {/* Pollutant tabs */}
                    <div className="flex border-b border-gray-200 dark:border-gray-700">
                      {POLLUTANT_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => onPollutantChange?.(opt.id)}
                          className={`
                            flex-1 py-2.5 text-center text-xs font-bold uppercase tracking-wider transition-all relative
                            ${pollutant === opt.id
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                            }
                          `}
                        >
                          {opt.label}
                          {pollutant === opt.id && (
                            <motion.div
                              layoutId="pollutant-indicator"
                              className="absolute bottom-0 left-2 right-2 h-0.5 bg-sky-500 rounded-full"
                            />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Active pollutant info */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">
                            {activePollutant.label}
                            {activePollutant.unit && (
                              <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">
                                ({activePollutant.unit})
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                            {activePollutant.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Wind className="w-3.5 h-3.5 text-sky-500" />
                          <span className="text-[10px] text-gray-500 dark:text-gray-400">VAYU Engine</span>
                        </div>
                      </div>

                      {/* Gradient color bar */}
                      <div className="mb-2">
                        <div
                          className="h-3 rounded-full w-full"
                          style={{ background: `linear-gradient(to right, ${gradient})` }}
                        />
                      </div>

                      {/* Scale labels */}
                      <div className="flex justify-between px-0.5">
                        <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500">
                          {colorStops[0].v}
                        </span>
                        <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500">
                          {colorStops[Math.floor(colorStops.length / 2)].v}
                        </span>
                        <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500">
                          {colorStops[colorStops.length - 1].v}
                        </span>
                      </div>

                      {/* Description tip */}
                      <div className="mt-3 flex items-start gap-2 p-2.5 rounded-xl bg-white dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700/50">
                        <Activity className="w-3.5 h-3.5 text-sky-500 mt-0.5 flex-shrink-0" />
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                          Road-level pollution overlay powered by VAYU CALINE3 dispersion model.
                          Colors represent estimated concentration per road segment based on traffic volume,
                          street canyon effect, and real-time weather conditions.
                          Zoom in (level 13+) to see road-level detail.
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
