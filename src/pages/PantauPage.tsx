import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Download, Flame, Radio, Wind, MapPinned } from 'lucide-react';
import { Seo } from '../components/Seo';
import StatCard from '../components/viz/StatCard';
import BarChart from '../components/viz/BarChart';
import Rincian from '../components/viz/Rincian';
import SourceLine from '../components/viz/SourceLine';
import { useIsDark } from '../stores/settingsStore';
import { fieldBase } from '../lib/field/source';
import { saringUrut, type DaftarPrioritas } from '../lib/prioritas';
import type { FireFile } from '../lib/nasional/firms';
import { windAt, type WindFile } from '../lib/nasional/angin';
import { fasilitasCsv, nearby, PANTAU_WILAYAH, perPulau } from '../lib/nasional/pantau';

const PantauMap = lazy(() => import('../components/pantau/PantauMap'));

const ARAH = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
const arahDari = (deg: number) => ARAH[Math.round(deg / 45) % 8];
const n = (v: number | null | undefined, d = 0) => (v == null ? '…' : v.toLocaleString('id-ID', { maximumFractionDigits: d }));

function useJson<T>(path: string | null): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    fetch(path, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((j) => alive && setV(j)).catch(() => alive && setV(null));
    return () => { alive = false; };
  }, [path]);
  return v;
}

/** Hour index of the wind file closest to now. */
function windHour(w: WindFile | null): number {
  if (!w?.hours.length) return 0;
  const now = Date.now();
  let best = 0;
  w.hours.forEach((h, i) => { if (Math.abs(Date.parse(h) - now) < Math.abs(Date.parse(w.hours[best]) - now)) best = i; });
  return best;
}

/** /pantau and /pantau/:wilayah (N-11): monitoring for everyone, no login; numbers first, details folded. */
export default function PantauPage() {
  const { wilayah } = useParams();
  const dark = useIsDark();
  const region = PANTAU_WILAYAH.find((w) => w.slug === wilayah) ?? null;
  const b = fieldBase();
  const fires = useJson<FireFile>(`${b}/v/nasional/titik_api.json`);
  const wind = useJson<WindFile>(`${b}/v/nasional/angin.json`);
  const manifest = useJson<{ sensors_used?: number; computed_at?: string; indicative?: boolean }>(region ? `${b}/v/${region.field}/manifest.json` : null);
  const daftar = useJson<DaftarPrioritas>(region ? `/data/prioritas/${region.field}.json` : null);
  const h = windHour(wind);
  const pulau = useMemo(() => perPulau(fires?.points ?? []), [fires]);
  const dekat = useMemo(() => (region && fires ? nearby(fires.points, region.lat, region.lon, 150) : []), [fires, region]);
  const top = useMemo(() => (daftar ? saringUrut(daftar.fasilitas, { kelas: 'semua', cari: '', urutan: 'lalin' }).slice(0, 10) : []), [daftar]);
  const anginSini = region && wind ? windAt(wind, region.lon, region.lat, h) : null;

  const unduh = () => {
    if (!daftar || !region) return;
    const url = URL.createObjectURL(new Blob([fasilitasCsv(daftar.fasilitas)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `breeva_prioritas_${region.field}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <Seo title={region ? `Pemantauan udara ${region.label} · Breeva` : 'Pemantauan udara Indonesia · Breeva'}
        description="Titik api 24 jam, arah angin, sekolah dan faskes paling terpapar asap kendaraan, unduh data. Tanpa akun." path={region ? `/pantau/${region.slug}` : '/pantau'} />
      <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
        <header className="flex items-center gap-2">
          <Link to={region ? '/pantau' : '/'} className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-full bg-white dark:bg-gray-900" aria-label="Kembali">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-white">{region ? `Pemantauan ${region.label}` : 'Pemantauan udara Indonesia'}</h1>
        </header>

        {!region && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="Titik api" value={n(fires?.n)} note="24 jam, NASA FIRMS" tone={fires?.n ? 'warn' : 'neutral'} icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />} />
              <StatCard label="Pulau terbanyak" value={pulau[0]?.nama ?? '…'} note={pulau[0] ? `${n(pulau[0].n)} titik` : ''} icon={<MapPinned className="h-3.5 w-3.5" aria-hidden="true" />} />
              <StatCard label="Wilayah per ruas" value="2" note="Badung–Denpasar, Kota Bogor" icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />} />
              <StatCard label="Angin" value={wind ? `${wind.speed.length}` : '…'} note="titik prakiraan tiap jam" icon={<Wind className="h-3.5 w-3.5" aria-hidden="true" />} />
            </div>
            <Suspense fallback={<div className="h-[26rem] rounded-2xl bg-gray-200/60 dark:bg-gray-800/60 animate-pulse" />}>
              <PantauMap fires={fires?.points ?? []} wind={wind} hour={h} center={[-2.5, 118]} zoom={5} dark={dark} />
            </Suspense>
            <p className="text-xs text-gray-600 dark:text-gray-300">Titik merah: api terdeteksi satelit dalam 24 jam terakhir (makin besar makin panas). Panah biru: arah angin jam ini, ke mana asap terbawa.</p>
            {pulau.length > 0 && (
              <div className="rounded-2xl bg-white dark:bg-gray-900 p-4">
                <BarChart title="Titik api 24 jam per pulau" bars={pulau.map((p, i) => ({ label: p.nama, value: p.n, highlight: i === 0, color: i === 0 ? '#dc2626' : '#fb923c' }))} />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Artinya: di pulau teratas paling banyak pembakaran atau kebakaran lahan hari ini; asapnya bisa terbawa angin ratusan kilometer.</p>
              </div>
            )}
            <nav className="grid gap-2 sm:grid-cols-2" aria-label="Wilayah dengan peta per ruas">
              {PANTAU_WILAYAH.map((w) => (
                <Link key={w.slug} to={`/pantau/${w.slug}`} className="rounded-2xl bg-white dark:bg-gray-900 p-4 border border-gray-100 dark:border-gray-800">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{w.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{w.tingkat === 'terukur' ? 'Terukur: sensor warga dan stasiun' : 'Indikatif: belum ada titik ukur di dalam kota'}</p>
                </Link>
              ))}
            </nav>
          </>
        )}

        {region && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="PM2,5 latar" value={n(daftar?.ringkasan.pm25_median, 1)} unit="µg/m³" note="median wilayah" />
              <StatCard label="Asap kendaraan" value={n(daftar?.ringkasan.asap_median, 1)} unit="µg/m³" note={daftar?.ringkasan.asap_p90 != null ? `10% ruas di atas ${n(daftar.ringkasan.asap_p90, 1)}` : 'median ruas'} />
              <StatCard label="Titik api" value={n(dekat.length)} note="dalam 150 km, 24 jam" tone={dekat.length ? 'warn' : 'good'} icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />} />
              <StatCard label="Angin" value={anginSini ? `${n(anginSini.speed, 1)} m/s` : '…'} note={anginSini ? `dari ${arahDari(anginSini.from)}` : ''} icon={<Wind className="h-3.5 w-3.5" aria-hidden="true" />} />
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Tingkat keyakinan: <b>{region.tingkat === 'terukur' ? 'terukur' : 'indikatif'}</b>
              {manifest?.sensors_used != null && ` · ${manifest.sensors_used} sensor warga jam ini`}
            </p>
            {top.length > 0 && (
              <div className="rounded-2xl bg-white dark:bg-gray-900 p-4">
                <BarChart title="10 sekolah dan faskes paling terpapar asap kendaraan" unit="µg/m³"
                  bars={top.map((f, i) => ({ label: f.nama, value: f.no2_lalin, highlight: i < 3, color: i < 3 ? '#7c3aed' : '#a78bfa' }))} />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Artinya: fasilitas teratas paling layak didahulukan, misalnya tutup jalan depan gerbang pada jam masuk.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={unduh} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white">
                    <Download className="h-4 w-4" aria-hidden="true" />Unduh CSV ({n(daftar?.jumlah)} fasilitas)
                  </button>
                  <Link to={`/prioritas?wilayah=${region.field}`} className="inline-flex min-h-9 items-center rounded-full bg-gray-100 dark:bg-gray-800 px-4 text-sm font-semibold">Daftar lengkap</Link>
                </div>
              </div>
            )}
            <Suspense fallback={<div className="h-[26rem] rounded-2xl bg-gray-200/60 dark:bg-gray-800/60 animate-pulse" />}>
              <PantauMap fires={dekat.map((d) => d.p)} wind={wind} hour={h} center={[region.lat, region.lon]} zoom={8} dark={dark} />
            </Suspense>
            <Rincian summary="Titik api terdekat">
              {dekat.length === 0 ? <p>Tidak ada titik api dalam 150 km dalam 24 jam terakhir.</p> : (
                <ul className="space-y-1">
                  {dekat.slice(0, 10).map((d, i) => <li key={i}>{n(d.km)} km · {d.p[4].replace('T', ' ').replace('Z', ' UTC')} · daya {n(d.p[2], 1)} MW</li>)}
                </ul>
              )}
            </Rincian>
          </>
        )}
        <SourceLine>NASA FIRMS (VIIRS NOAA-20, NOAA-21, S-NPP), Open-Meteo, OpenStreetMap, OpenAQ, CAMS; diperbarui tiap jam.</SourceLine>
      </div>
    </main>
  );
}
