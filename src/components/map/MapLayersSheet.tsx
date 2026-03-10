import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Map, Satellite, Mountain, Wind, Store,
  TreePine, Waves,
} from 'lucide-react';
import type { AirQualityData, PollutantType } from '../../types';
import { POLLUTANT_OPTIONS } from './RoadPollutionLayer';

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

interface DetailToggle {
  id: string;
  label: string;
  icon: typeof Wind;
  active: boolean;
  onToggle: () => void;
  color: string;
  description: string;
}

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
  const details: DetailToggle[] = [
    {
      id: 'poi',
      label: 'Places',
      icon: Store,
      active: showPOIs,
      onToggle: onPOIsToggle,
      color: '#16a34a',
      description: 'Nearby restaurants, shops, parks',
    },
    {
      id: 'aqi',
      label: 'Air Quality',
      icon: Wind,
      active: showAQIOverlay,
      onToggle: onAQIOverlayToggle,
      color: '#0ea5e9',
      description: currentAQI ? `AQI ${currentAQI.aqi} — ${currentAQI.level.replace('-', ' ')}` : 'Show AQI zones',
    },
  ];

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
            className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl max-h-[70vh] overflow-y-auto"
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
            <div className="px-5 pt-4 pb-6">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                Map Details
              </p>
              <div className="grid grid-cols-2 gap-3">
                {details.map((detail) => {
                  const Icon = detail.icon;
                  return (
                    <button
                      key={detail.id}
                      onClick={detail.onToggle}
                      className={`
                        flex flex-col items-start gap-2 p-3.5 rounded-2xl border-2 transition-all text-left
                        ${detail.active
                          ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                          : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                        }
                      `}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center"
                          style={{
                            backgroundColor: detail.active ? detail.color + '18' : undefined,
                          }}
                        >
                          <Icon
                            className="w-4.5 h-4.5"
                            style={{ color: detail.active ? detail.color : '#9ca3af' }}
                          />
                        </div>
                      </div>
                      <div>
                        <p
                          className={`text-sm font-semibold ${
                            detail.active
                              ? 'text-gray-900 dark:text-white'
                              : 'text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {detail.label}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">
                          {detail.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* AQI Legend when active */}
            <AnimatePresence>
              {showAQIOverlay && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mx-5 mb-5 p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Waves className="w-3.5 h-3.5 text-sky-500" />
                      <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        AQI Legend
                      </span>
                    </div>
                    {/* Pollutant tabs */}
                    <div className="flex gap-1.5 mb-3">
                      {POLLUTANT_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => onPollutantChange?.(opt.id)}
                          className={`
                            px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all
                            ${pollutant === opt.id
                              ? 'bg-sky-500 text-white shadow-sm'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }
                          `}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Good', color: '#22c55e', range: '0-50' },
                        { label: 'Moderate', color: '#eab308', range: '51-100' },
                        { label: 'Sensitive', color: '#f97316', range: '101-150' },
                        { label: 'Unhealthy', color: '#ef4444', range: '151-200' },
                        { label: 'Very Bad', color: '#a855f7', range: '201-300' },
                        { label: 'Hazardous', color: '#7f1d1d', range: '300+' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <div>
                            <p className="text-[10px] font-medium text-gray-600 dark:text-gray-300 leading-none">
                              {item.label}
                            </p>
                            <p className="text-[9px] text-gray-400 dark:text-gray-500 font-mono leading-none mt-0.5">
                              {item.range}
                            </p>
                          </div>
                        </div>
                      ))}
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
