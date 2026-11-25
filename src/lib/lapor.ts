/** N-12: citizen smoke reports. Sent to the database function lapor_kirim (5 per device per 24 hours); the place is rounded
 * to 3 decimals (about 100 m) before it leaves the phone, and the reporter is never shown, only counts per cell. */

export const JENIS_LAPOR = [
  { id: 'sampah', label: 'Pembakaran sampah' },
  { id: 'lahan', label: 'Kebakaran atau pembakaran lahan' },
  { id: 'kendaraan', label: 'Asap kendaraan' },
  { id: 'usaha', label: 'Asap usaha atau pabrik' },
  { id: 'debu', label: 'Debu proyek' },
  { id: 'lainnya', label: 'Lainnya' },
] as const;

export type JenisLapor = (typeof JENIS_LAPOR)[number]['id'];

/** The official national complaint channel; the user opens it themselves (Breeva never forwards on their behalf). */
export const LAPOR_GO_ID = 'https://www.lapor.go.id/';

const KEY = 'breeva_lapor_perangkat';

/** A random id for this phone (no account, no hardware id); only used to cap reports per day. */
export function perangkatId(store: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string {
  try {
    const v = store?.getItem(KEY);
    if (v && /^[0-9a-f]{32}$/.test(v)) return v;
  } catch { /* private mode */ }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const id = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  try { store?.setItem(KEY, id); } catch { /* not kept: a new id next time */ }
  return id;
}

export const bulat3 = (v: number) => Math.round(v * 1000) / 1000;

export interface LaporInput { jenis: JenisLapor; lat: number; lng: number; catatan?: string }
export type LaporHasil = { ok: true; sisa: number } | { ok: false; alasan: 'batas' | 'jenis' | 'lokasi' | 'perangkat' | 'jaringan' | 'konfigurasi'; sisa?: number };

/** The request lapor_kirim expects, coordinates already rounded. */
export function laporBody(i: LaporInput, perangkat: string, uji = false) {
  return { p_jenis: i.jenis, p_lat: bulat3(i.lat), p_lng: bulat3(i.lng), p_perangkat: perangkat, p_catatan: i.catatan?.trim().slice(0, 280) || null, p_uji: uji };
}

export async function kirimLaporan(i: LaporInput, opts: { url?: string; key?: string; fetchFn?: typeof fetch; perangkat?: string } = {}): Promise<LaporHasil> {
  const url = opts.url ?? import.meta.env.VITE_SUPABASE_URL;
  const key = opts.key ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, alasan: 'konfigurasi' };
  try {
    const r = await (opts.fetchFn ?? fetch)(`${url}/rest/v1/rpc/lapor_kirim`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(laporBody(i, opts.perangkat ?? perangkatId())),
    });
    if (!r.ok) return { ok: false, alasan: 'jaringan' };
    return (await r.json()) as LaporHasil;
  } catch {
    return { ok: false, alasan: 'jaringan' };
  }
}

/** Text the user can paste into LAPOR! (kind, rounded place, time, map link). */
export function teksLapor(i: LaporInput, now = new Date()): string {
  const label = JENIS_LAPOR.find((j) => j.id === i.jenis)?.label ?? i.jenis;
  const t = now.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const lat = bulat3(i.lat), lng = bulat3(i.lng);
  return `${label} di sekitar ${lat}, ${lng} (${t}). Peta: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}${i.catatan?.trim() ? `. Keterangan: ${i.catatan.trim().slice(0, 280)}` : ''}`;
}

export interface RingkasLapor { lat: number; lng: number; jenis: JenisLapor; hari: string; jumlah: number; pelapor: number }

/** Counts per 0.01 degree cell, kind and day for the last 7 days (test rows never included). */
export async function ambilRingkas(opts: { url?: string; key?: string; fetchFn?: typeof fetch } = {}): Promise<RingkasLapor[] | null> {
  const url = opts.url ?? import.meta.env.VITE_SUPABASE_URL;
  const key = opts.key ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await (opts.fetchFn ?? fetch)(`${url}/rest/v1/laporan_ringkas?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    return ((await r.json()) as RingkasLapor[]).map((x) => ({ ...x, lat: Number(x.lat), lng: Number(x.lng) }));
  } catch {
    return null;
  }
}

/** Totals of a summary list: reports and (an upper bound of) devices. */
export function totalRingkas(rows: RingkasLapor[]): { laporan: number; pelapor: number } {
  return rows.reduce((a, r) => ({ laporan: a.laporan + r.jumlah, pelapor: a.pelapor + r.pelapor }), { laporan: 0, pelapor: 0 });
}
