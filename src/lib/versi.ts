// Build stamp shown on /status and at the foot of /peta, so a screenshot tells which build a phone runs.
// __BUILD_TIME__ (ISO, UTC) and __BUILD_COMMIT__ (7 characters) are set by vite.config.ts `define`.
declare const __BUILD_TIME__: string;
declare const __BUILD_COMMIT__: string;

export const VERSI_WAKTU: string = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
export const VERSI_COMMIT: string = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "26 Nov 2026, 18.40 WIB · ff8fc2a" (WIB = UTC+7, computed without the device time zone). */
export function capVersi(iso: string = VERSI_WAKTU, commit: string = VERSI_COMMIT): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return `versi ${commit}`;
  const d = new Date(t + 7 * 3600 * 1000);
  const jam = `${String(d.getUTCHours()).padStart(2, '0')}.${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${jam} WIB · ${commit}`;
}
