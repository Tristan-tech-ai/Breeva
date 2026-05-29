// Persist a computed exposure dose to public.exposure_ledger (RLS: logged-in own rows only).
// Used by /paparan "Simpan" and walk completion. Anonymous → no-op (page still works).
import { supabase } from './supabase';
import type { ExposureDoseResult, UserExposureProfile } from './exposure';

export interface SaveExposureMeta {
  source: 'paparan' | 'walk';
  label?: string;
  walk_id?: string | null;
  durationSeconds: number;
  segmentCount?: number;
}

export async function saveExposureLedger(
  result: ExposureDoseResult,
  profile: UserExposureProfile,
  meta: SaveExposureMeta,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { ok: false, error: 'not_logged_in' };

    const { error } = await supabase.from('exposure_ledger').insert({
      user_id: uid,
      walk_id: meta.walk_id ?? null,
      source: meta.source,
      label: meta.label ?? null,
      user_age_bucket: profile.age_bucket,
      user_mode: profile.mode,
      user_health_sensitive: profile.health_sensitive,
      duration_seconds: Math.round(meta.durationSeconds),
      segment_count: meta.segmentCount ?? null,
      pm25_mean_ugm3: result.mean_pm25,
      pm25_peak_ugm3: result.peak_pm25,
      breathing_rate_m3min: result.breathing_rate_m3min,
      penetration: result.penetration,
      intake_fraction: result.intake_fraction,
      dose_ug: result.dose_ug,
      who_24h_ratio: result.who_24h_ratio,
      cigarette_equiv: result.cigarette_equiv,
      risk_level: result.risk_level,
      calculation_method: 'haber_epa_v1',
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
