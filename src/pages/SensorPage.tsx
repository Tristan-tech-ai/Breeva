import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Copy, Radio } from 'lucide-react';
import { Seo } from '../components/Seo';
import Rincian from '../components/viz/Rincian';
import { useIsDark } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { fieldBase } from '../lib/field/source';
import type { ScFile } from '../lib/nasional/sensorCommunity';
import { ALASAN_SENSOR, ambilSensorPublik, contohCurl, contohEsphome, TIPE_SENSOR, type SensorPublik, type TipeSensor } from '../lib/sensorSendiri';

const PantauMap = lazy(() => import('../components/pantau/PantauMap'));
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** N-27: open and own sensors. Shown on the map as "tidak dipakai model"; owners register and get a device token once. */
export default function SensorPage() {
  const dark = useIsDark();
  const user = useAuthStore((s) => s.user);
  const [sc, setSc] = useState<ScFile | null>(null);
  const [milikPublik, setMilikPublik] = useState<SensorPublik[] | null>(null);
  useEffect(() => {
    fetch(`${fieldBase()}/v/nasional/sensor_community.json`).then((r) => (r.ok ? r.json() : null)).then(setSc).catch(() => {});
    void ambilSensorPublik().then(setMilikPublik);
  }, []);
  const titik = useMemo(() => [
    ...(sc?.sensors ?? []).map((s) => ({ lat: s.lat, lon: s.lon, label: `Sensor.Community ${s.id}${s.pm25 != null ? ` · PM2,5 ${s.pm25} µg/m³` : ''} · tidak dipakai model` })),
    ...(milikPublik ?? []).map((s) => ({ lat: s.lat, lon: s.lng, label: `${s.nama}${s.pm25 != null ? ` · PM2,5 ${s.pm25} µg/m³` : ''} · tidak dipakai model` })),
  ], [sc, milikPublik]);

  const [nama, setNama] = useState('');
  const [tipe, setTipe] = useState<TipeSensor>('http');
  const [publik, setPublik] = useState(true);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [scId, setScId] = useState('');
  const [hasil, setHasil] = useState<{ ok: boolean; token?: string; alasan?: string } | null>(null);
  const [kirim, setKirim] = useState(false);
  const daftar = async () => {
    setKirim(true);
    try {
      const { supabase } = await import('../lib/supabase');
      const { data, error } = await supabase.rpc('sensor_daftar', { p_nama: nama, p_tipe: tipe, p_publik: publik, p_lat: Number(lat), p_lng: Number(lng), p_sc_id: tipe === 'sensor_community' ? scId : null });
      setHasil(error ? { ok: false, alasan: 'jaringan' } : (data as { ok: boolean; token?: string; alasan?: string }));
    } catch {
      setHasil({ ok: false, alasan: 'jaringan' });
    }
    setKirim(false);
  };
  const [milik, setMilik] = useState<Array<{ id: string; nama: string; tipe: string; publik: boolean }> | null>(null);
  useEffect(() => {
    if (!user) return;
    void import('../lib/supabase').then(({ supabase }) => supabase.from('sensors').select('id,nama,tipe,publik').then(({ data }) => setMilik((data as typeof milik) ?? [])));
  }, [user, hasil]);
  const lokasiku = () => navigator.geolocation?.getCurrentPosition((p) => { setLat(p.coords.latitude.toFixed(3)); setLng(p.coords.longitude.toFixed(3)); });

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Seo title="Sensor sendiri · Breeva" description="Pasang sensor PM2,5 sendiri dan tampilkan di peta Breeva: ESP32, Home Assistant, AirGradient, Sensor.Community." path="/sensor" />
      <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
        <header className="flex items-center gap-2">
          <Link to="/pantau" className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-full bg-white dark:bg-gray-900" aria-label="Kembali"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>
          <h1 className="text-lg font-extrabold">Sensor sendiri</h1>
        </header>
        <p className="rounded-xl bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200" data-tidak-model>
          Sensor di halaman ini tampil di peta tetapi <b>tidak dipakai model</b>: angka peta Breeva hanya memakai sumber yang lolos uji lokasi yang disembunyikan.
        </p>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl bg-white dark:bg-gray-900 p-3"><Radio className="mx-auto h-4 w-4 text-sky-700" aria-hidden="true" /><p className="text-xl font-extrabold tabular-nums">{sc ? sc.sensors.length : '…'}</p><p className="text-[11px] text-gray-600 dark:text-gray-300">Sensor.Community di Indonesia</p></div>
          <div className="rounded-2xl bg-white dark:bg-gray-900 p-3"><Radio className="mx-auto h-4 w-4 text-emerald-700" aria-hidden="true" /><p className="text-xl font-extrabold tabular-nums">{milikPublik ? milikPublik.length : '…'}</p><p className="text-[11px] text-gray-600 dark:text-gray-300">sensor warga Breeva (publik)</p></div>
        </div>
        <Suspense fallback={<div className="rounded-2xl bg-gray-200/60 dark:bg-gray-800/60 animate-pulse" style={{ height: '26rem' }} />}>
          <PantauMap fires={[]} wind={null} center={[-2.5, 118]} zoom={5} dark={dark} sensors={titik} />
        </Suspense>

        <section className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 space-y-3" data-daftar-sensor>
          <h2 className="text-base font-bold">Daftarkan sensormu</h2>
          {!user ? (
            <p className="text-sm">Masuk dulu supaya sensor tercatat atas akunmu. <Link to="/login" className="font-semibold underline">Masuk</Link></p>
          ) : hasil?.ok ? (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-emerald-800 dark:text-emerald-300">Terdaftar. Simpan token ini sekarang; Breeva hanya menyimpan sidik jarinya dan tidak bisa menampilkannya lagi.</p>
              <pre className="overflow-x-auto rounded-xl bg-gray-100 dark:bg-gray-800 p-2 text-xs" tabIndex={0}>{hasil.token}</pre>
              <button onClick={() => { void navigator.clipboard?.writeText(hasil.token ?? ''); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 px-3 text-xs font-semibold"><Copy className="h-4 w-4" aria-hidden="true" />Salin token</button>
              <Rincian summary="Contoh kirim: curl" open><pre className="overflow-x-auto text-[11px]" tabIndex={0}>{contohCurl(SB_URL, SB_KEY, hasil.token ?? '')}</pre></Rincian>
              <Rincian summary="Contoh kirim: ESPHome (ESP32 + PMS5003)"><pre className="overflow-x-auto text-[11px]" tabIndex={0}>{contohEsphome(SB_URL, SB_KEY, hasil.token ?? '')}</pre></Rincian>
            </div>
          ) : (
            <>
              <label className="block text-xs font-semibold">Nama sensor
                <input value={nama} onChange={(e) => setNama(e.target.value.slice(0, 60))} placeholder="mis. Teras rumah Denpasar" className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" />
              </label>
              <fieldset>
                <legend className="text-xs font-semibold">Jenis</legend>
                <div className="mt-1 grid gap-2">
                  {TIPE_SENSOR.map((t) => (
                    <button key={t.id} type="button" aria-pressed={tipe === t.id} onClick={() => setTipe(t.id)}
                      className={`rounded-xl px-3 py-2 text-left text-sm ring-1 ${tipe === t.id ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-gray-50 dark:bg-gray-800 ring-gray-200 dark:ring-gray-700'}`}>
                      <span className="font-semibold">{t.label}</span><span className="block text-[11px] opacity-90">{t.merek}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {tipe === 'sensor_community' && (
                <label className="block text-xs font-semibold">ID sensor Sensor.Community
                  <input value={scId} onChange={(e) => setScId(e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-semibold">Lintang<input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="-8.650" className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" /></label>
                <label className="block text-xs font-semibold">Bujur<input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" placeholder="115.220" className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" /></label>
              </div>
              <button type="button" onClick={lokasiku} className="min-h-9 rounded-full bg-gray-100 dark:bg-gray-800 px-3 text-xs font-semibold">Pakai lokasiku</button>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publik} onChange={(e) => setPublik(e.target.checked)} /> Tampilkan di peta untuk semua orang (lokasi dibulatkan sekitar 100 m)</label>
              {hasil && !hasil.ok && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{ALASAN_SENSOR[hasil.alasan ?? ''] ?? 'Gagal mendaftar.'}</p>}
              <button onClick={daftar} disabled={kirim || nama.trim().length < 2 || !lat || !lng} className="w-full min-h-11 rounded-2xl bg-emerald-700 font-bold text-white disabled:opacity-50">{kirim ? 'Mendaftar…' : 'Daftarkan sensor'}</button>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Sensor privat hanya terlihat olehmu. Paling banyak 1 bacaan per menit per sensor.</p>
            </>
          )}
        </section>
        {user && milik && milik.length > 0 && (
          <section className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4" data-sensor-milik>
            <h2 className="text-sm font-bold">Sensormu ({milik.length})</h2>
            <ul className="mt-1 text-sm space-y-1">{milik.map((m) => <li key={m.id}>{m.nama} · {m.tipe} · {m.publik ? 'publik' : 'privat (hanya kamu)'}</li>)}</ul>
          </section>
        )}
        <Rincian summary="Merek dan cara sambung">
          <ul className="space-y-1">
            {TIPE_SENSOR.map((t) => <li key={t.id}><b>{t.label}</b>: {t.merek}.</li>)}
            <li>AirGradient: pakai integrasi AirGradient di Home Assistant, lalu rest_command ke sensor_kirim dengan token di atas.</li>
          </ul>
        </Rincian>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">Sumber: Sensor.Community (DbCL 1.0), sensor warga Breeva. {sc && `Diambil ${new Date(sc.updated_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB.`}</p>
      </div>
    </main>
  );
}
