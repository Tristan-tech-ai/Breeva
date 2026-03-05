import { useState } from 'react';
import { Circle, LayerGroup, useMap } from 'react-leaflet';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Eye, EyeOff } from 'lucide-react';
import type { AirQualityData, Coordinate } from '../../types';

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

/**
 * Deterministic hash for an offset to produce repeatable "variation".
 * Uses a simple integer hash so the overlay is stable across re-renders.
 */
function deterministicVariation(latOff: number, lngOff: number, seed: number): number {
  const h = Math.abs(Math.sin(latOff * 1234.5 + lngOff * 6789.1 + seed) * 10000);
  return (h % 41) - 20; // range –20 … +20
}

// Generate deterministic AQI zones around user location for visual effect
function generateAQIZones(center: Coordinate, baseAQI: number): AQIZone[] {
  const zones: AQIZone[] = [];

  // Inner zone — user's fetched AQI
  zones.push({ center, radius: 300, aqi: baseAQI });

  // Surrounding zones with deterministic variation
  const offsets = [
    { lat: 0.003, lng: 0.002 },
    { lat: -0.002, lng: 0.004 },
    { lat: 0.004, lng: -0.003 },
    { lat: -0.003, lng: -0.002 },
    { lat: 0.001, lng: 0.005 },
    { lat: -0.005, lng: 0.001 },
  ];

  offsets.forEach((offset, i) => {
    const variation = deterministicVariation(offset.lat, offset.lng, i);
    const radiusSeed = Math.abs(Math.sin(i * 111.1) * 200);
    zones.push({
      center: {
        lat: center.lat + offset.lat,
        lng: center.lng + offset.lng,
      },
      radius: 200 + radiusSeed,
      aqi: Math.max(10, Math.min(300, baseAQI + variation)),
    });
  });

  return zones;
}

// Map inner component for AQI circles
function AQICircles({ zones }: { zones: AQIZone[] }) {
  useMap(); // ensure component is inside MapContainer
  return (
    <LayerGroup>
      {zones.map((zone, i) => (
        <Circle
          key={i}
          center={[zone.center.lat, zone.center.lng]}
          radius={zone.radius}
          pathOptions={{
            color: getAQIColor(zone.aqi),
            fillColor: getAQIColor(zone.aqi),
            fillOpacity: 0.15,
            weight: 1,
            opacity: 0.3,
          }}
        />
      ))}
    </LayerGroup>
  );
}

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
              {visible ? <Eye className="w-3.5 h-3.5 text-primary-500" /> : <EyeOff className="w-3.5 h-3.5 text-gray-400" />}
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
                  <span className="text-[10px] text-gray-400 font-mono">{item.range}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export { AQICircles, generateAQIZones, getAQIColor as getOverlayAQIColor };
