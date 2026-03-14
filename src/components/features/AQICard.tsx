import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Wind, Droplets, CloudSun, Activity, Info } from 'lucide-react';
import type { AirQualityData } from '../../types';
import { getAQIColor } from '../map/LeafletMap';
import { getAQILabel, getAQIEmoji } from './AQIBadge';

interface AQICardProps {
  data: AirQualityData;
  className?: string;
}

type DetailLevel = 'glance' | 'detail' | 'expert';

export default function AQICard({ data, className = '' }: AQICardProps) {
  const [level, setLevel] = useState<DetailLevel>('glance');
  const color = getAQIColor(data.aqi);
  const percentage = Math.min(data.aqi, 300) / 300;

  return (
    <motion.div
      layout
      className={`rounded-2xl overflow-hidden bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm cursor-pointer select-none ${className}`}
      onClick={() => {
        if (level === 'glance') setLevel('detail');
        else if (level === 'detail') setLevel('expert');
        else setLevel('glance');
      }}
    >
      {/* Glanceable Level */}
      <div className="p-4 flex items-center gap-3.5">
        {/* Circular gauge */}
        <div className="relative w-14 h-14 flex-shrink-0">
          <svg className="w-14 h-14 transform -rotate-90" viewBox="0 0 56 56">
            <circle
              cx="28"
              cy="28"
              r="23"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              className="text-gray-100 dark:text-gray-800"
            />
            <circle
              cx="28"
              cy="28"
              r="23"
              fill="none"
              stroke={color}
              strokeWidth="5"
              strokeDasharray={`${percentage * 144.5} 144.5`}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{data.aqi}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Wind size={14} style={{ color }} strokeWidth={2.5} />
            <span className="text-sm font-bold" style={{ color }}>
              {getAQILabel(data.aqi)}
            </span>
            <span className="text-sm">{getAQIEmoji(data.aqi)}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
            {data.aqi <= 50
              ? 'Great for walking! Enjoy the fresh air.'
              : data.aqi <= 100
                ? 'Acceptable. Consider shade routes.'
                : 'Consider staying on cleaner routes.'}
          </p>
        </div>

        <motion.div
          animate={{ rotate: level === 'glance' ? 0 : 180 }}
          transition={{ duration: 0.2 }}
          className="text-gray-400 dark:text-gray-500"
        >
          <ChevronDown size={16} strokeWidth={2} />
        </motion.div>
      </div>

      {/* Detail Level */}
      <AnimatePresence>
        {(level === 'detail' || level === 'expert') && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800/50 pt-3">
              {/* Pollutant cards */}
              <div className="grid grid-cols-3 gap-2">
                <PollutantCard label="PM2.5" value={data.pm25} unit="µg/m³" icon={<Droplets size={12} />} />
                <PollutantCard label="PM10" value={data.pm10} unit="µg/m³" icon={<CloudSun size={12} />} />
                <PollutantCard label="O₃" value={data.o3} unit="ppb" icon={<Wind size={12} />} />
                {level === 'expert' && (
                  <>
                    <PollutantCard label="NO₂" value={data.no2} unit="ppb" icon={<Activity size={12} />} />
                    <PollutantCard label="CO" value={data.co} unit="ppm" icon={<Activity size={12} />} />
                    <PollutantCard label="SO₂" value={data.so2} unit="ppb" icon={<Activity size={12} />} />
                  </>
                )}
              </div>

              {/* VAYU confidence + freshness */}
              {data.confidence !== undefined && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-800">
                    {data.confidence >= 0.7 ? '🟢' : data.confidence >= 0.4 ? '🟡' : '🔴'}
                    <span className="text-gray-600 dark:text-gray-300">
                      {data.confidence >= 0.7 ? 'Akurat' : data.confidence >= 0.4 ? 'Estimasi' : 'Kasar'}
                    </span>
                  </span>
                  {data.freshness && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      data.freshness === 'live' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                      data.freshness === 'recent' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                      {data.freshness === 'live' ? '⚡ Live' :
                       data.freshness === 'recent' ? '🕐 Baru' :
                       data.freshness === 'stale' ? '⚠️ Lama' : '⚠️ Fallback'}
                    </span>
                  )}
                </div>
              )}

              {/* Data source & timestamp */}
              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
                <div className="flex items-center gap-1">
                  <Info size={10} />
                  <span>
                    {data.layer_source === 3 ? 'Sensor langsung' :
                     data.layer_source === 2 ? 'Crowdsource' :
                     data.layer_source === 4 ? 'ML prediction' :
                     'VAYU Dispersion Engine'}
                  </span>
                </div>
                <span>
                  {new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <p className="text-center text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                Tap for {level === 'detail' ? 'raw data' : 'less detail'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PollutantCard({ label, value, unit, icon }: { label: string; value: number; unit: string; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-950/80 rounded-xl p-2.5 text-center">
      <div className="flex items-center justify-center gap-1 mb-1">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">{label}</p>
      </div>
      <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{value != null ? value.toFixed(1) : '—'}</p>
      <p className="text-[10px] text-gray-400 dark:text-gray-500">{unit}</p>
    </div>
  );
}
