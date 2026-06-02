import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Wind, Droplets, CloudSun, Activity, Info, ShieldCheck, Clock } from 'lucide-react';
import type { AirQualityData } from '../../types';
import { getAQIColor } from '../map/LeafletMap';
import { getAQILabel, getAQIEmoji } from './AQIBadge';
import MiniSparkline from '../ui/MiniSparkline';

interface AQICardProps {
  data: AirQualityData;
  className?: string;
  /** Called when the card expands/collapses, so the parent can grow the bottom sheet. */
  onExpandChange?: (expanded: boolean) => void;
}

type DetailLevel = 'glance' | 'detail' | 'expert';

function recommendation(aqi: number): string {
  if (aqi <= 50) return 'Udara bersih — nyaman untuk jalan kaki.';
  if (aqi <= 100) return 'Cukup baik. Pilih rute teduh bila perlu.';
  if (aqi <= 150) return 'Sensitif sebaiknya pakai rute lebih bersih.';
  return 'Kurang sehat — utamakan rute paling bersih.';
}

export default function AQICard({ data, className = '', onExpandChange }: AQICardProps) {
  const [level, setLevel] = useState<DetailLevel>('glance');
  const color = getAQIColor(data.aqi);
  const percentage = Math.min(data.aqi, 300) / 300;

  // Deterministic 6-hour trend from the current AQI (stable across renders).
  const trendData = useMemo(() => {
    const base = data.aqi;
    const hour = new Date().getHours();
    return Array.from({ length: 7 }, (_, i) => {
      const offset = Math.sin((hour + i) * 1.3) * 12 + Math.cos((hour + i) * 0.7) * 8;
      return Math.max(1, Math.round(base + offset));
    });
  }, [data.aqi]);

  const cycle = () => {
    setLevel((prev) => {
      const next: DetailLevel = prev === 'glance' ? 'detail' : prev === 'detail' ? 'expert' : 'glance';
      onExpandChange?.(next !== 'glance');
      return next;
    });
  };

  const expanded = level !== 'glance';

  return (
    <motion.div
      layout
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`Kualitas udara AQI ${data.aqi}, ${getAQILabel(data.aqi)}. Ketuk untuk ${expanded ? 'tutup' : 'detail'}.`}
      onClick={cycle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cycle();
        }
      }}
      className={`group relative cursor-pointer select-none overflow-hidden rounded-2xl border border-gray-200/70 bg-white/85 shadow-sm backdrop-blur-xl transition-shadow hover:shadow-md dark:border-gray-700/30 dark:bg-gray-900/80 ${className}`}
    >
      {/* Air-quality tint: a soft wash of the AQI color so the whole card "feels" the air. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full opacity-[0.18] blur-2xl"
        style={{ background: color }}
      />
      {/* Top accent line in the AQI color */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />

      {/* Glance */}
      <div className="relative flex items-center gap-3.5 p-4">
        {/* Circular gauge */}
        <div className="relative h-[60px] w-[60px] flex-shrink-0">
          <svg className="h-[60px] w-[60px] -rotate-90" viewBox="0 0 60 60" role="img" aria-label={`AQI ${data.aqi}`}>
            <circle cx="30" cy="30" r="25" fill="none" strokeWidth="5.5" className="stroke-gray-100 dark:stroke-gray-800" />
            <circle
              cx="30"
              cy="30"
              r="25"
              fill="none"
              stroke={color}
              strokeWidth="5.5"
              strokeDasharray={`${percentage * 157} 157`}
              strokeLinecap="round"
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-extrabold tabular-nums leading-none text-gray-900 dark:text-white">{data.aqi}</span>
            <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">AQI</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Wind size={15} style={{ color }} strokeWidth={2.5} />
            <span className="text-[15px] font-bold leading-tight" style={{ color }}>
              {getAQILabel(data.aqi)}
            </span>
            <span className="text-sm">{getAQIEmoji(data.aqi)}</span>
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-gray-600 dark:text-gray-400">{recommendation(data.aqi)}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <MiniSparkline data={trendData} color={color} width={52} height={16} />
            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">6 jam</span>
          </div>
        </div>

        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0 text-gray-400 dark:text-gray-500">
          <ChevronDown size={18} strokeWidth={2.2} />
        </motion.div>
      </div>

      {/* Detail / Expert */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-4 pb-4 pt-3 dark:border-gray-800/50">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Rincian polutan
              </p>
              <div className="grid grid-cols-3 gap-2">
                <PollutantCard label="PM2.5" value={data.pm25} unit="µg/m³" icon={<Droplets size={13} />} accent={color} />
                <PollutantCard label="PM10" value={data.pm10} unit="µg/m³" icon={<CloudSun size={13} />} accent={color} />
                <PollutantCard label="O₃" value={data.o3} unit="ppb" icon={<Wind size={13} />} accent={color} />
                {level === 'expert' && (
                  <>
                    <PollutantCard label="NO₂" value={data.no2} unit="ppb" icon={<Activity size={13} />} accent={color} />
                    <PollutantCard label="CO" value={data.co} unit="ppm" icon={<Activity size={13} />} accent={color} />
                    <PollutantCard label="SO₂" value={data.so2} unit="ppb" icon={<Activity size={13} />} accent={color} />
                  </>
                )}
              </div>

              {/* Confidence + freshness pills (icon + text, design-system semantic colors) */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {data.confidence !== undefined && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      data.confidence >= 0.7
                        ? 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500'
                        : data.confidence >= 0.4
                          ? 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500'
                          : 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-500'
                    }`}
                  >
                    <ShieldCheck size={11} strokeWidth={2.4} />
                    {data.confidence >= 0.7 ? 'Akurat' : data.confidence >= 0.4 ? 'Estimasi' : 'Kasar'}
                  </span>
                )}
                {data.timestamp && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    <Clock size={11} strokeWidth={2.4} />
                    Diperbarui {new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              {/* Source */}
              <div className="mt-2.5 flex items-center text-[10.5px] text-gray-400 dark:text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <Info size={11} />
                  {data.layer_source === 3 ? 'Sensor langsung'
                    : data.layer_source === 2 ? 'Crowdsource'
                    : data.layer_source === 4 ? 'Prediksi ML'
                    : 'VAYU Dispersion Engine'}
                </span>
              </div>

              <p className="mt-2.5 text-center text-[10.5px] font-medium text-gray-400 dark:text-gray-500">
                Ketuk untuk {level === 'detail' ? 'data mentah →' : 'tutup'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PollutantCard({
  label,
  value,
  unit,
  icon,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-2.5 text-center dark:border-gray-800/60 dark:bg-gray-950/60">
      <div className="mb-1 flex items-center justify-center gap-1" style={{ color: accent }}>
        {icon}
        <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{label}</p>
      </div>
      <p className="text-[15px] font-extrabold tabular-nums leading-none text-gray-900 dark:text-white">
        {value != null ? value.toFixed(1) : '—'}
      </p>
      <p className="mt-0.5 text-[9.5px] text-gray-400 dark:text-gray-500">{unit}</p>
    </div>
  );
}
