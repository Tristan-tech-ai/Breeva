/**
 * Tier 2 M1 — Route AQI weight slider.
 *
 * α ∈ [0, 1]:
 *   0.0  → fastest    (pure time-optimal Dijkstra)
 *   0.5  → balanced   (default)
 *   1.0  → cleanest   (pure Haber-dose minimization)
 *
 * Posts to /api/vayu/route-score as `aqi_weight`. Three preset chips for
 * non-technical users; slider for power users.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, Scale, Leaf } from 'lucide-react';

type Preset = { label: string; alpha: number; Icon: typeof Zap; tone: string };

const PRESETS: Preset[] = [
  { label: 'Pakai cepat', alpha: 0.0, Icon: Zap,   tone: 'from-gray-500 to-gray-600' },
  { label: 'Seimbang',    alpha: 0.5, Icon: Scale, tone: 'from-blue-500 to-cyan-500' },
  { label: 'Pakai bersih', alpha: 1.0, Icon: Leaf,  tone: 'from-emerald-500 to-green-500' },
];

interface Props {
  value: number;                       // current alpha
  onChange: (alpha: number) => void;
}

export default function RouteAqiSlider({ value, onChange }: Props) {
  const [showSlider, setShowSlider] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {PRESETS.map((p) => {
          const isActive = Math.abs(p.alpha - value) < 0.05;
          const Icon = p.Icon;
          return (
            <motion.button
              key={p.label}
              whileTap={{ scale: 0.95 }}
              onClick={() => onChange(p.alpha)}
              className={`
                flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-all
                ${isActive
                  ? `bg-gradient-to-r ${p.tone} text-white shadow-md`
                  : 'bg-white/60 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700'}
              `}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Icon className="w-4 h-4" />
                {p.label}
              </span>
            </motion.button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setShowSlider((s) => !s)}
        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        {showSlider ? 'Sembunyikan slider' : 'Atur manual'}
      </button>

      {showSlider && (
        <div className="px-1">
          <input
            type="range"
            min="0" max="1" step="0.05"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full accent-emerald-500"
            aria-label="AQI weight slider"
          />
          <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400 mt-1">
            <span>Cepat</span>
            <span>{value.toFixed(2)}</span>
            <span>Bersih</span>
          </div>
        </div>
      )}
    </div>
  );
}
