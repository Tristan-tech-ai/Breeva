import { motion, useReducedMotion } from 'framer-motion';
import { User, Wind, Activity, ShieldCheck, ShieldAlert, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  AGE_LABELS, MODE_LABELS, INTAKE_FRACTION, PENETRATION,
  type AgeBucket, type ExposureMode, type UserExposureProfile,
} from '../../lib/exposure';

const AGES: AgeBucket[] = ['child', 'adult', 'elderly'];
const MODES: ExposureMode[] = [
  'walk_slow', 'walk_fast', 'jog', 'cycle',
  'motorcycle_open', 'motorcycle_full', 'car_window_open', 'car_ac_fresh', 'car_ac_recirculate', 'public_transport',
];

// Contextual feedback that ties the chosen mode to the dose model (intake fraction + penetration).
type Tone = 'emerald' | 'amber' | 'sky';
const TONE: Record<Tone, string> = {
  emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
  amber: 'text-amber-700 dark:text-amber-300 bg-amber-500/10',
  sky: 'text-sky-700 dark:text-sky-300 bg-sky-500/10',
};
function modeHint(mode: ExposureMode): { text: string; tone: Tone; Icon: LucideIcon } {
  const intake = INTAKE_FRACTION[mode] ?? 1;
  const pen = PENETRATION[mode] ?? 1;
  if (intake < 1) {
    return { text: `Tertutup — menyaring ~${Math.round((1 - intake) * 100)}% partikel`, tone: 'emerald', Icon: ShieldCheck };
  }
  if (pen > 1) {
    return { text: `Napas ${pen.toFixed(1)}× lebih dalam saat berolahraga`, tone: 'amber', Icon: Activity };
  }
  return { text: 'Udara terbuka penuh — tanpa perlindungan', tone: 'sky', Icon: Wind };
}

export default function ProfileForm({
  profile, onChange,
}: {
  profile: UserExposureProfile;
  onChange: (p: UserExposureProfile) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const hint = modeHint(profile.mode);
  const HintIcon = hint.Icon;

  return (
    <div className="glass-card p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <User className="w-4 h-4 text-primary-500" /> Profil Anda
      </h3>

      {/* Age bucket — segmented with a sliding active pill */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block">Kelompok usia</label>
        <div className="relative flex p-1 rounded-xl bg-gray-100 dark:bg-gray-800">
          {AGES.map((a) => {
            const active = profile.age_bucket === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => onChange({ ...profile, age_bucket: a })}
                className="relative flex-1 px-2 py-2 text-xs font-semibold z-10 rounded-lg transition-colors"
              >
                {active && (
                  <motion.span
                    layoutId="agePill"
                    className="absolute inset-0 rounded-lg bg-white dark:bg-gray-700 shadow-sm"
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className={`relative ${active ? 'text-primary-600 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400'}`}>
                  {AGE_LABELS[a]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode — styled select + contextual protection hint */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block">Moda perjalanan</label>
        <div className="relative">
          <select
            value={profile.mode}
            onChange={(e) => onChange({ ...profile, mode: e.target.value as ExposureMode })}
            className="w-full appearance-none px-3 py-2.5 pr-9 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
          >
            {MODES.map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        <div className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${TONE[hint.tone]}`}>
          <HintIcon className="w-3.5 h-3.5" /> {hint.text}
        </div>
      </div>

      {/* Health sensitive — real toggle switch */}
      <button
        type="button"
        role="switch"
        aria-checked={profile.health_sensitive}
        onClick={() => onChange({ ...profile, health_sensitive: !profile.health_sensitive })}
        className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition ${
          profile.health_sensitive
            ? 'border-amber-400/60 bg-amber-500/10'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }`}
      >
        <span className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${profile.health_sensitive ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile.health_sensitive ? 'translate-x-4' : ''}`} />
        </span>
        <span className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <ShieldAlert className={`w-3.5 h-3.5 ${profile.health_sensitive ? 'text-amber-500' : 'text-gray-400'}`} />
          Saya sensitif (asma, jantung, hamil, lansia)
        </span>
      </button>
    </div>
  );
}
