import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wind, ShieldCheck, ShieldAlert, ChevronUp, ChevronDown } from 'lucide-react';
import { CIG_UG, riskBand } from '../../lib/exposure';

interface LiveExposureTrackerProps {
  /** Current AQI value (updates in real-time) */
  currentAQI: number | null;
  /** Walk duration so far in seconds */
  durationSeconds: number;
  /** Whether walk is paused */
  isPaused: boolean;
}

// Breathing rates by activity (m³/hour)
const BREATHING_RATE = 1.5; // walking pace

// EPA PM2.5 breakpoints: [AQI_lo, AQI_hi, PM25_lo, PM25_hi]
const PM25_BREAKPOINTS: [number, number, number, number][] = [
  [0, 50, 0.0, 12.0],
  [51, 100, 12.1, 35.4],
  [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 150.4],
  [201, 300, 150.5, 250.4],
  [301, 500, 250.5, 500.4],
];

function aqiToPM25(aqi: number): number {
  for (const [aqiLo, aqiHi, pmLo, pmHi] of PM25_BREAKPOINTS) {
    if (aqi >= aqiLo && aqi <= aqiHi) {
      return pmLo + ((aqi - aqiLo) / (aqiHi - aqiLo)) * (pmHi - pmLo);
    }
  }
  return aqi > 300 ? 350 : 5; // fallback
}

const RISK_CONFIG = {
  low: { label: 'Aman', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800/30' },
  moderate: { label: 'Sedang', color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800/30' },
  high: { label: 'Tinggi', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800/30' },
  very_high: { label: 'Bahaya', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800/30' },
};

/**
 * Real-time exposure tracker shown during active walks.
 * Accumulates PM2.5 dose from current AQI readings.
 */
export default function LiveExposureTracker({ currentAQI, isPaused }: LiveExposureTrackerProps) {
  const [expanded, setExpanded] = useState(false);
  const cumulativeDoseRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const [displayDose, setDisplayDose] = useState(0);
  const [displayCig, setDisplayCig] = useState(0);

  // Accumulate dose every second based on current AQI
  useEffect(() => {
    if (isPaused || currentAQI === null) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000; // seconds elapsed
      lastTickRef.current = now;

      const pm25 = aqiToPM25(currentAQI);
      // dose (µg) = concentration (µg/m³) × breathing_rate (m³/h) × time (h)
      const doseDelta = pm25 * BREATHING_RATE * (dt / 3600);
      cumulativeDoseRef.current += doseDelta;

      setDisplayDose(cumulativeDoseRef.current);
      // Unified cigarette benchmark = CIG_UG (660 µg PM2.5 ≈ 1 cig, Pope 2009) — shared with the
      // /paparan calculator + RouteCard + WalkComplete so the whole app reports ONE number.
      setDisplayCig(cumulativeDoseRef.current / CIG_UG);
    }, 2000);

    return () => clearInterval(interval);
  }, [currentAQI, isPaused]);

  // Reset lastTick on pause toggle to avoid jumps
  useEffect(() => {
    lastTickRef.current = Date.now();
  }, [isPaused]);

  // Placeholder when AQI hasn't loaded yet. The tracker must always be visible
  // during an active walk so users know the feature exists; silently returning
  // null hides it entirely.
  if (currentAQI === null) {
    return (
      <div className="mt-3 rounded-2xl border border-gray-200 dark:border-gray-700/30 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
        <Wind size={12} className="text-gray-400 animate-pulse" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Live Exposure
        </span>
        <span className="ml-auto text-[10px] text-gray-400">Sampling air quality…</span>
      </div>
    );
  }

  const risk = riskBand(displayDose);   // unified dose-µg bands (shared lib)
  const cfg = RISK_CONFIG[risk];
  const pm25Now = aqiToPM25(currentAQI);

  return (
    <motion.div
      layout
      className={`mt-3 rounded-2xl border ${cfg.border} overflow-hidden`}
    >
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 ${cfg.bg} transition-colors`}
      >
        <Wind size={12} className={cfg.color} />
        <span className={`text-[10px] font-bold ${cfg.color} uppercase tracking-wider`}>
          Live Exposure
        </span>
        <span className={`ml-auto text-xs font-bold tabular-nums ${cfg.color}`}>
          {displayCig < 0.01 ? '<0.01' : displayCig.toFixed(2)} 🚬
        </span>
        {expanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronUp size={12} className="text-gray-400" />}
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2.5 grid grid-cols-3 gap-2 bg-white/50 dark:bg-gray-900/30">
              <div className="text-center">
                <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                  {pm25Now.toFixed(1)}
                </p>
                <p className="text-[9px] text-gray-500 dark:text-gray-400">µg/m³ now</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                  {displayDose.toFixed(1)}
                </p>
                <p className="text-[9px] text-gray-500 dark:text-gray-400">µg total</p>
              </div>
              <div className="text-center">
                <p className={`text-sm font-bold ${cfg.color}`}>
                  {cfg.label}
                </p>
                <p className="text-[9px] text-gray-500 dark:text-gray-400">risiko</p>
              </div>
            </div>

            {/* Safety tip */}
            <div className="px-3 pb-2">
              {risk === 'low' ? (
                <div className="flex items-center gap-1.5 text-[9px] text-green-600 dark:text-green-400">
                  <ShieldCheck size={10} />
                  <span>Udara bersih — lanjutkan aktivitas! 🎉</span>
                </div>
              ) : risk === 'moderate' ? (
                <div className="flex items-center gap-1.5 text-[9px] text-yellow-600 dark:text-yellow-400">
                  <ShieldAlert size={10} />
                  <span>Paparan sedang — pertimbangkan istirahat jika sensitif</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[9px] text-red-600 dark:text-red-400">
                  <ShieldAlert size={10} />
                  <span>Paparan tinggi — pertimbangkan rute alternatif</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
