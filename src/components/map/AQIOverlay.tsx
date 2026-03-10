import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Eye, EyeOff } from 'lucide-react';
import type { AirQualityData, Coordinate } from '../../types';
import { getAirQuality } from '../../lib/api';

interface AQIOverlayProps {
  currentAQI: AirQualityData | null;
  userLocation: Coordinate | null;
}

interface AQIZone {
  center: Coordinate;
  radius: number;
  aqi: number;
}

function getAQIColor(aqi: number): string {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#eab308';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#7f1d1d';
}

// Surrounding offsets (~300-500m grid) to sample AQI from VAYU
const GRID_OFFSETS = [
  { lat: 0, lng: 0 },
  { lat: 0.003, lng: 0.002 },
  { lat: -0.002, lng: 0.004 },
  { lat: 0.004, lng: -0.003 },
  { lat: -0.003, lng: -0.002 },
  { lat: 0.001, lng: 0.005 },
  { lat: -0.005, lng: 0.001 },
];

/**
 * Fetch real AQI zones from VAYU Engine for surrounding grid cells.
 * Falls back to deterministic variation if fetch fails.
 */
async function fetchAQIZones(center: Coordinate, baseAQI: number): Promise<AQIZone[]> {
  const zones: AQIZone[] = [];

  const results = await Promise.allSettled(
    GRID_OFFSETS.map(async (offset) => {
      const coord = {
        lat: center.lat + offset.lat,
        lng: center.lng + offset.lng,
      };
      const { data } = await getAirQuality(coord);
      return {
        center: coord,
        radius: offset.lat === 0 && offset.lng === 0 ? 300 : 200 + Math.abs(Math.sin(offset.lat * 1000) * 200),
        aqi: data?.aqi ?? baseAQI,
      };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      zones.push(r.value);
    }
  }

  // Fallback: if no zones returned, use base AQI center
  if (zones.length === 0) {
    zones.push({ center, radius: 300, aqi: baseAQI });
  }

  return zones;
}

// AQI zone type export for LeafletMap
export type { AQIZone };

export function AQIOverlayToggle({ currentAQI: _currentAQI, userLocation: _userLocation }: AQIOverlayProps) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setVisible(!visible)}
        className={`
          w-10 h-10 rounded-xl flex items-center justify-center
          transition-all duration-200 shadow-md
          ${visible
            ? 'bg-primary-500 text-white shadow-primary-500/30'
            : 'glass-card text-gray-600 dark:text-gray-400 hover:text-primary-500'
          }
        `}
        title={visible ? 'Hide AQI overlay' : 'Show AQI overlay'}
      >
        <Layers className="w-4.5 h-4.5" />
      </button>

      {/* Legend (shows when overlay is visible) */}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            className="absolute top-12 right-0 glass-card p-3 min-w-[140px]"
          >
            <div className="flex items-center gap-2 mb-2">
              {visible ? <Eye className="w-3.5 h-3.5 text-primary-500" /> : <EyeOff className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />}
              <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">AQI Zones</span>
            </div>
            <div className="space-y-1.5">
              {[
                { label: 'Good', color: '#22c55e', range: '0-50' },
                { label: 'Moderate', color: '#eab308', range: '51-100' },
                { label: 'Sensitive', color: '#f97316', range: '101-150' },
                { label: 'Unhealthy', color: '#ef4444', range: '151-200' },
                { label: 'Very Bad', color: '#a855f7', range: '201-300' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[10px] text-gray-600 dark:text-gray-400 flex-1">{item.label}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{item.range}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export { fetchAQIZones, getAQIColor as getOverlayAQIColor };
