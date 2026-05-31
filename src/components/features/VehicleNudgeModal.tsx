import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Footprints, Leaf } from 'lucide-react';
import { TRANSPORT_MODES } from '../../lib/api';

const DISMISS_KEY = 'breeva_vehicle_nudge_dismissed';

/** Whether the user has chosen "jangan tampilkan lagi" for the no-carbon nudge. */
export function isVehicleNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  /** The motorized mode that triggered the nudge, or null when hidden. */
  mode: 'motorcycle' | 'car' | null;
  /** Switch the route to walking. */
  onSwitchToWalking: () => void;
  /** Keep the motorized mode and dismiss the nudge. */
  onContinue: () => void;
}

/**
 * Gentle nudge shown when a user picks a motorized vehicle: no-carbon transport
 * (walk/cycle) earns EcoPoints and cuts pollution. Persists a "don't show again"
 * choice in localStorage (OnboardingTour pattern) so it educates once, then stays
 * out of the way.
 */
export default function VehicleNudgeModal({ mode, onSwitchToWalking, onContinue }: Props) {
  const [dontShow, setDontShow] = useState(false);

  const persist = () => {
    if (dontShow) {
      try {
        localStorage.setItem(DISMISS_KEY, '1');
      } catch {
        /* storage full / unavailable — non-fatal */
      }
    }
  };
  const handleSwitch = () => {
    persist();
    onSwitchToWalking();
  };
  const handleContinue = () => {
    persist();
    onContinue();
  };

  const modeInfo = TRANSPORT_MODES.find((m) => m.id === mode);
  const modeLabel = mode === 'car' ? 'mobil' : 'motor';
  const mult = modeInfo?.ecoPointsMultiplier ?? 0;

  return (
    <AnimatePresence>
      {mode && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleContinue}
        >
          <motion.div
            className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-2xl"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mx-auto mb-4">
              <Leaf className="w-7 h-7 text-primary-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white text-center">
              Pilih kendaraan tanpa karbon 🌱
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-2">
              Dengan {modeLabel}, kamu {mult === 0 ? 'tidak mengumpulkan' : 'hanya dapat sedikit'} EcoPoints.
              Jalan kaki atau sepeda memberi koin lebih banyak sekaligus mengurangi polusi udara.
            </p>

            {/* comparison */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="rounded-2xl p-3 text-center bg-gray-100 dark:bg-gray-800">
                <div className="text-xs text-gray-500 capitalize">{modeLabel}</div>
                <div className="text-base font-bold text-gray-700 dark:text-gray-300">×{mult} pts</div>
                <div className="text-[10px] text-gray-400">{modeInfo?.co2PerKm ?? 0}g CO₂/km</div>
              </div>
              <div className="rounded-2xl p-3 text-center bg-primary-50 dark:bg-primary-950/30 border border-primary-200/60 dark:border-primary-800/40">
                <div className="text-xs text-primary-600 dark:text-primary-400 flex items-center justify-center gap-1">
                  <Footprints className="w-3 h-3" /> Jalan kaki
                </div>
                <div className="text-base font-bold text-primary-600 dark:text-primary-400">×1.5 pts</div>
                <div className="text-[10px] text-primary-500/70">0g CO₂ · bersih</div>
              </div>
            </div>

            {/* don't show again */}
            <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShow}
                onChange={(e) => setDontShow(e.target.checked)}
                className="w-4 h-4 rounded accent-primary-500"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">Jangan tampilkan lagi</span>
            </label>

            {/* actions */}
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={handleSwitch}
                className="w-full gradient-primary text-white py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Footprints className="w-4 h-4" /> Ganti ke jalan kaki
              </button>
              <button
                onClick={handleContinue}
                className="w-full py-3 rounded-2xl font-medium text-sm text-gray-500 dark:text-gray-400"
              >
                Tetap pakai {modeLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
