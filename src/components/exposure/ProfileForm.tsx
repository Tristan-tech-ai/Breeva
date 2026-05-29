import { ShieldAlert } from 'lucide-react';
import {
  AGE_LABELS, MODE_LABELS,
  type AgeBucket, type ExposureMode, type UserExposureProfile,
} from '../../lib/exposure';

const AGES: AgeBucket[] = ['child', 'adult', 'elderly'];
const MODES: ExposureMode[] = [
  'walk_slow', 'walk_fast', 'jog', 'cycle',
  'motorcycle_open', 'motorcycle_full', 'car_window_open', 'car_ac_fresh', 'car_ac_recirculate', 'public_transport',
];

export default function ProfileForm({
  profile, onChange,
}: {
  profile: UserExposureProfile;
  onChange: (p: UserExposureProfile) => void;
}) {
  return (
    <div className="glass-card p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Profil Anda</h3>

      {/* Age bucket — segmented */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block">Kelompok usia</label>
        <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          {AGES.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onChange({ ...profile, age_bucket: a })}
              className={`flex-1 px-2 py-2 text-xs font-medium transition ${
                profile.age_bucket === a
                  ? 'bg-primary-500 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {AGE_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      {/* Mode — dropdown */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block">Moda perjalanan</label>
        <select
          value={profile.mode}
          onChange={(e) => onChange({ ...profile, mode: e.target.value as ExposureMode })}
          className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          {MODES.map((m) => (
            <option key={m} value={m}>{MODE_LABELS[m]}</option>
          ))}
        </select>
      </div>

      {/* Health sensitive */}
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={profile.health_sensitive}
          onChange={(e) => onChange({ ...profile, health_sensitive: e.target.checked })}
          className="w-4 h-4 rounded accent-primary-500"
        />
        <span className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
          Saya sensitif (asma, jantung, hamil, lansia)
        </span>
      </label>
    </div>
  );
}
