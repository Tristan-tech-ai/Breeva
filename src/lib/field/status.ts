/**
 * Freshness of a published field manifest (shared by the /status page and scripts/field/field-status.mts). The target
 * of ROADMAP_BREEVA_3 is a manifest younger than 75 minutes; the hourly builder runs at :20 each hour.
 */
export const FRESH_MINUTES = 75;

export interface ManifestLike {
  run?: string;
  computed_at?: string;
  sensors_used?: number;
  indicative?: boolean;
  measurement?: { method?: string | null };
}

export interface FieldStatus {
  ok: boolean;
  run?: string;
  computed_at?: string;
  age_min?: number;
  sensors?: number;
  method?: string | null;
  indicative?: boolean;
  error?: string;
}

export function manifestStatus(m: ManifestLike | null | undefined, now: Date, maxMin = FRESH_MINUTES): FieldStatus {
  const t = Date.parse(m?.computed_at ?? '');
  if (!m?.run || !Number.isFinite(t)) return { ok: false, error: 'manifest without run or computed_at' };
  const ageMin = Math.round(((now.getTime() - t) / 60000) * 10) / 10;
  return {
    ok: ageMin >= -5 && ageMin <= maxMin, run: m.run, computed_at: m.computed_at, age_min: ageMin,
    sensors: m.sensors_used ?? 0, method: m.measurement?.method ?? null, indicative: m.indicative ?? false,
  };
}

/** Plain-language line for the status page. */
export function statusText(s: FieldStatus): string {
  if (s.error) return 'Manifest tidak terbaca';
  const age = s.age_min! < 1 ? 'kurang dari 1 menit' : `${Math.round(s.age_min!)} menit`;
  const src = s.method === 'kriging' ? `${s.sensors} sensor warga` : s.method === 'koschmieder' ? 'jarak pandang bandara' : 'model tanpa sensor';
  return `${s.ok ? 'Segar' : 'Basi'}: dihitung ${age} lalu · ${src}${s.indicative ? ' · indikatif' : ''}`;
}

export interface LayeredManifest extends ManifestLike {
  valid_hour_local?: number;
  measurement?: { method?: string | null; sensor_hour_utc?: string | null };
}

export interface LayerAges { exhaust: string; background: string; stale: boolean }

const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}.00`;

/** "25 menit", "89 menit", "3 jam", "2 hari": how long ago, in whole units (minutes below 2 hours). */
export function agoWords(min: number): string {
  if (min < 120) return `${Math.max(1, Math.round(min))} menit`; // "1 jam" for 89 min would understate it
  if (min < 48 * 60) return `${Math.round(min / 60)} jam`;
  return `${Math.round(min / 1440)} hari`;
}

/**
 * Age of each layer of the field in plain words (task F5-15): the exhaust part is computed for the run's own hour
 * (current wind, that hour's traffic curve); the background comes from the citizen sensors' last complete hour
 * (OpenAQ gives hourly averages about an hour late) or from the global model.
 */
export function layerAges(m: LayeredManifest | null | undefined, now: Date): LayerAges | null {
  const s = manifestStatus(m, now);
  if (s.error || !m?.run || m.valid_hour_local == null) return null;
  const tz = (m.valid_hour_local - Number(m.run.slice(8, 10)) + 24) % 24;
  const stale = !s.ok;
  const exhaust = `Asap kendaraan: jam ${hh(m.valid_hour_local)} (angin saat ini dan pola lalu lintas jam itu)`;
  let background: string;
  const sh = Date.parse(m.measurement?.sensor_hour_utc ?? '');
  if (m.measurement?.method === 'kriging' && Number.isFinite(sh)) {
    const startLocal = new Date(sh).getUTCHours() + tz;
    const endedMin = Math.max(0, Math.round((now.getTime() - (sh + 3_600_000)) / 60000));
    background = `Udara latar: ${s.sensors} sensor warga, rata-rata jam ${hh(startLocal)}–${hh(startLocal + 1)} (selesai ${endedMin} menit lalu)`;
  } else if (m.measurement?.method === 'koschmieder') {
    background = 'Udara latar: model global, dinaikkan menurut jarak pandang bandara';
  } else {
    background = 'Udara latar: model global (belum ada sensor di wilayah ini)';
  }
  if (!stale) return { exhaust, background, stale };
  // old data (e.g. a phone offline since then): say how old, and do not call that hour's wind "current"
  const oldExhaust = `Data lama, dihitung ${agoWords(s.age_min ?? 0)} lalu. Asap kendaraan: jam ${hh(m.valid_hour_local)} (angin dan pola lalu lintas jam itu, bukan sekarang)`;
  return { exhaust: oldExhaust, background, stale };
}
