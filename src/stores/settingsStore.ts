import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { formatDistance, formatKm } from '../lib/utils';

// Single source of truth for all app settings. Two persistence layers:
//   • localStorage under the SAME `breeva_<key>` names existing readers already use
//     (main.tsx, walkStore, ContributePage, notifications) → zero-break back-compat.
//   • cloud `user_settings` (now incl. distance_unit, language, high_contrast).
// `location_tracking` is intentionally dropped (it gated a non-existent feature).

export type DistanceUnit = 'km' | 'miles';
export type Locale = 'en' | 'id';

export interface AppSettings {
  dark_mode: boolean;
  high_contrast: boolean;
  push_notifications: boolean;
  quest_reminders: boolean;
  anonymous_data: boolean;
  profile_visible: boolean;
  distance_unit: DistanceUnit;
  language: Locale;
}

const DEFAULTS: AppSettings = {
  dark_mode: false,
  high_contrast: false,
  push_notifications: true,
  quest_reminders: true,
  anonymous_data: true,
  profile_visible: true,
  distance_unit: 'km',
  language: 'en',
};

const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof AppSettings)[];
const lsKey = (k: keyof AppSettings) => `breeva_${k}`;

function readLocal(): AppSettings {
  const s: AppSettings = { ...DEFAULTS };
  if (typeof localStorage === 'undefined') return s;
  for (const k of SETTING_KEYS) {
    const raw = localStorage.getItem(lsKey(k));
    if (raw == null) continue;
    if (k === 'distance_unit') s.distance_unit = raw === 'miles' ? 'miles' : 'km';
    else if (k === 'language') s.language = raw === 'id' ? 'id' : 'en';
    else (s as unknown as Record<string, unknown>)[k] = raw === 'true';
  }
  return s;
}

interface SettingsState extends AppSettings {
  hydrated: boolean;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  hydrateFromCloud: (userId: string) => Promise<void>;
  resetToDefaults: () => void;
  applyTheme: () => void;
}

const dirty = new Set<keyof AppSettings>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;

async function pushToCloud(s: AppSettings): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id;
    if (!uid) return;
    await supabase.from('user_settings').upsert({
      user_id: uid,
      dark_mode: s.dark_mode,
      high_contrast: s.high_contrast,
      push_notifications: s.push_notifications,
      quest_reminders: s.quest_reminders,
      anonymous_data: s.anonymous_data,
      profile_visible: s.profile_visible,
      distance_unit: s.distance_unit,
      language: s.language,
      updated_at: new Date().toISOString(),
    });
    dirty.clear();
  } catch { /* offline / non-fatal */ }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...readLocal(),
  hydrated: false,

  applyTheme: () => {
    if (typeof document === 'undefined') return;
    const { dark_mode, high_contrast } = get();
    document.documentElement.classList.toggle('dark', dark_mode);
    document.documentElement.classList.toggle('high-contrast', high_contrast);
  },

  set: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);
    try { localStorage.setItem(lsKey(key), String(value)); } catch { /* ignore */ }
    dirty.add(key);
    if (key === 'dark_mode' || key === 'high_contrast') get().applyTheme();
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { void pushToCloud(get()); }, 400);
  },

  hydrateFromCloud: async (userId) => {
    try {
      const { data } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
      if (data) {
        const patch: Partial<AppSettings> = {};
        for (const k of SETTING_KEYS) {
          if (dirty.has(k)) continue; // don't clobber a value the user changed this session
          const v = (data as Record<string, unknown>)[k];
          if (v !== null && v !== undefined) (patch as unknown as Record<string, unknown>)[k] = v;
        }
        set(patch as Partial<SettingsState>);
        for (const k of Object.keys(patch) as (keyof AppSettings)[]) {
          try { localStorage.setItem(lsKey(k), String((patch as unknown as Record<string, unknown>)[k])); } catch { /* ignore */ }
        }
        get().applyTheme();
      } else {
        await pushToCloud(get()); // first login on this account → seed the cloud row
      }
    } catch { /* offline / non-fatal */ }
    set({ hydrated: true });
  },

  resetToDefaults: () => {
    set({ ...DEFAULTS });
    for (const k of SETTING_KEYS) {
      try { localStorage.setItem(lsKey(k), String(DEFAULTS[k])); } catch { /* ignore */ }
    }
    get().applyTheme();
    void pushToCloud(get());
  },
}));

// Convenience selectors (reactive)
export const useIsDark = () => useSettingsStore((s) => s.dark_mode);
export const useDistanceUnit = () => useSettingsStore((s) => s.distance_unit);
export const useLocale = () => useSettingsStore((s) => s.language);

// Reactive distance formatters bound to the user's unit preference. Components call
// `const fmt = useFormatDistance()` then `fmt(meters)`; re-renders on unit change.
export const useFormatDistance = () => {
  const unit = useSettingsStore((s) => s.distance_unit);
  return (meters: number) => formatDistance(meters, unit);
};
export const useFormatKm = () => {
  const unit = useSettingsStore((s) => s.distance_unit);
  return (km: number) => formatKm(km, unit);
};
