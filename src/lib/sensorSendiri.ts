/** N-27: own sensors. Registration (signed in) through sensor_daftar, readings from the device through sensor_kirim
 * (token only), public sensors from the view sensor_publik. None of these readings enter the map numbers. */

export const TIPE_SENSOR = [
  { id: 'http', label: 'ESP32 / Home Assistant / HTTP', merek: 'ESP32 atau ESP8266 dengan PMS5003, PMS7003, SPS30, SDS011; sensor apa pun di Home Assistant' },
  { id: 'airgradient', label: 'AirGradient', merek: 'AirGradient ONE dan Open Air, lewat Home Assistant atau HTTP' },
  { id: 'sensor_community', label: 'Sensor.Community', merek: 'alat Sensor.Community (SDS011, SPS30, PMS); data ditarik tiap jam dari API terbukanya' },
] as const;
export type TipeSensor = (typeof TIPE_SENSOR)[number]['id'];

export interface SensorPublik { id: string; nama: string; tipe: TipeSensor; lat: number; lng: number; pm25: number | null; waktu: string | null }

export async function ambilSensorPublik(opts: { url?: string; key?: string; fetchFn?: typeof fetch } = {}): Promise<SensorPublik[] | null> {
  const url = opts.url ?? import.meta.env.VITE_SUPABASE_URL;
  const key = opts.key ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await (opts.fetchFn ?? fetch)(`${url}/rest/v1/sensor_publik?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    return ((await r.json()) as SensorPublik[]).map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) }));
  } catch {
    return null;
  }
}

/** The command a device or Home Assistant runs to send one reading (anon key is the app's public key). */
export function contohCurl(url: string, anonKey: string, token: string): string {
  return `curl -X POST '${url}/rest/v1/rpc/sensor_kirim' \\\n  -H 'apikey: ${anonKey}' -H 'Content-Type: application/json' \\\n  -d '{"p_token":"${token}","p_pm25":21.5,"p_pm10":30,"p_suhu":28.4,"p_rh":76}'`;
}

/** ESPHome: an http_request every minute with the PMS5003 values (sensor ids as in the ESPHome pmsx003 docs). */
export function contohEsphome(url: string, anonKey: string, token: string): string {
  return [
    'http_request:',
    '  verify_ssl: false',
    'interval:',
    '  - interval: 60s',
    '    then:',
    '      - http_request.post:',
    `          url: ${url}/rest/v1/rpc/sensor_kirim`,
    '          request_headers:',
    `            apikey: ${anonKey}`,
    '            Content-Type: application/json',
    '          json:',
    `            p_token: ${token}`,
    '            p_pm25: !lambda return id(pm25).state;',
    '            p_pm10: !lambda return id(pm10).state;',
  ].join('\n');
}

export const ALASAN_SENSOR: Record<string, string> = {
  masuk: 'Masuk dulu untuk mendaftarkan sensor.', batas: 'Paling banyak 10 sensor per akun.', isian: 'Periksa nama, lokasi (harus di Indonesia), dan ID Sensor.Community.',
  jaringan: 'Tidak tersambung. Coba lagi.',
};
