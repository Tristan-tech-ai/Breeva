import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { fasilitasCsv, kmBetween, nearby, PANTAU_WILAYAH } from '../lib/nasional/pantau';
import { perProvinsi } from '../lib/nasional/wilayah';
import type { LatarFile } from '../lib/nasional/latar';
import type { AsapFile } from '../lib/nasional/asap';
import { bacaIndeks, cariKabKota, latarSini, type KabKotaIndeks } from '../lib/nasional/kabkota';
import KabKotaView from '../components/pantau/KabKotaView';
import CctvRingkas from '../components/pantau/CctvRingkas';
import { CCTV_PATH, kameraKabKota, type CctvFile } from '../lib/nasional/cctv';
import LaporButton from '../components/lapor/LaporButton';
import { ambilRingkas, ambilUrgensi, JENIS_LAPOR, nilaiUrgensi, wargaMelapor, type RingkasLapor, type UrgensiBaris } from '../lib/lapor';

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

const PUSAT_INDONESIA: [number, number] = [-2.5, 118];
const jamWib = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) : '…');
const runWib = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB';

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
  const navigate = useNavigate();
  const b = fieldBase();
  const indeksFile = useJson<KabKotaIndeks>(`${b}/v/nasional/kabkota_indeks.json`);
  const latar = useJson<LatarFile>(`${b}/v/nasional/latar.json`);
  const asap = useJson<AsapFile>(`${b}/v/nasional/asap.json`);
  const cctv = useJson<CctvFile>(`${b}/${CCTV_PATH}`);
  const indeks = useMemo(() => bacaIndeks(indeksFile), [indeksFile]);
  const kab = !region && wilayah ? indeks.find((k) => k.slug === wilayah) ?? null : null;
  const [cari, setCari] = useState('');
  const hasil = useMemo(() => cariKabKota(indeks, cari), [indeks, cari]);
  const nilai = useMemo(() => Object.fromEntries(indeks.map((k) => [k.slug, latarSini(latar, k.slug)?.v ?? null])), [indeks, latar]);
  const namaKab = useMemo(() => Object.fromEntries(indeks.map((k) => [k.slug, k.nama])), [indeks]);
  const pusat = useMemo(() => (region ? { lat: region.lat, lon: region.lon } : kab ? { lat: kab.lat, lon: kab.lon } : null), [region, kab]);
  const fires = useJson<FireFile>(`${b}/v/nasional/titik_api.json`);
  const wind = useJson<WindFile>(`${b}/v/nasional/angin.json`);
  const manifest = useJson<{ sensors_used?: number; computed_at?: string; indicative?: boolean }>(region ? `${b}/v/${region.field}/manifest.json` : null);
  const daftar = useJson<DaftarPrioritas>(region ? `/data/prioritas/${region.field}.json` : null);
  const h = windHour(wind);
  const prov = useMemo(() => perProvinsi(fires?.points ?? []), [fires]);
  const dekat = useMemo(() => (region && fires ? nearby(fires.points, region.lat, region.lon, 150) : []), [fires, region]);
  const top = useMemo(() => (daftar ? saringUrut(daftar.fasilitas, { kelas: 'semua', cari: '', urutan: 'lalin' }).slice(0, 10) : []), [daftar]);
  const anginSini = region && wind ? windAt(wind, region.lon, region.lat, h) : null;
  const [lapor, setLapor] = useState<RingkasLapor[] | null>(null);
  useEffect(() => { let alive = true; void ambilRingkas().then((r) => alive && setLapor(r)); return () => { alive = false; }; }, []);
  const laporSini = useMemo(() => (lapor && pusat ? lapor.filter((r) => kmBetween(pusat.lat, pusat.lon, r.lat, r.lng) <= 25) : lapor), [lapor, pusat]);
  const [urgensi, setUrgensi] = useState<UrgensiBaris[] | null>(null);
  useEffect(() => { let alive = true; void ambilUrgensi().then((r) => alive && setUrgensi(r)); return () => { alive = false; }; }, []);
  const urgensiSini = useMemo(() => (urgensi && pusat ? urgensi.filter((r) => kmBetween(pusat.lat, pusat.lon, r.lat, r.lng) <= 25) : urgensi), [urgensi, pusat]);
  const mendesak = useMemo(() => nilaiUrgensi(urgensiSini ?? [], { api: [...(fires?.points ?? []), ...(fires?.luar_points ?? [])], fasilitas: daftar?.fasilitas }).slice(0, 3), [urgensiSini, fires, daftar]);
  // N-40: the map's inputs keep their identity across renders, so the canvas layers are built once per data file
  const apiSemua = useMemo(() => [...(fires?.points ?? []), ...(fires?.luar_points ?? [])], [fires]);
  const jalurAsap = useMemo(() => (asap?.gugus ?? []).slice(0, 30).map((g) => g.jalur), [asap]);
  const kameraSemua = useMemo(() => cctv?.kamera ?? [], [cctv]);
  const kameraSini = useMemo(() => (region ? kameraKabKota(cctv, region.slug) : []), [cctv, region]);
  const apiDekat = useMemo(() => dekat.map((d) => d.p), [dekat]);
  const pusatWilayah = useMemo<[number, number] | null>(() => (region ? [region.lat, region.lon] : null), [region]);
  const buka = useCallback((s: string) => navigate(`/pantau/${s}`), [navigate]);
  const choropleth = useMemo(() => ({ url: `${b}/v/nasional/kabkota_peta.geojson`, nilai, nama: namaKab, onPick: buka }), [b, nilai, namaKab, buka]);
  const laporJenis = useMemo(() => JENIS_LAPOR.map((j) => ({ label: j.label, value: (laporSini ?? []).filter((r) => r.jenis === j.id).reduce((a, r) => a + r.jumlah, 0) })).filter((b) => b.value > 0), [laporSini]);

  const unduh = () => {
    if (!daftar || !region) return;
    const url = URL.createObjectURL(new Blob([fasilitasCsv(daftar.fasilitas)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `breeva_prioritas_${region.field}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <Seo title={region ? `Pemantauan udara ${region.label} · Breeva` : kab ? `Pemantauan udara ${kab.nama} · Breeva` : 'Pemantauan udara Indonesia · Breeva'}
        description="Udara latar, titik api 24 jam, arah angin, laporan warga, unduh data. Tanpa akun." path={wilayah ? `/pantau/${wilayah}` : '/pantau'} />
      <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
        <header className="flex items-center gap-2">
          <Link to={wilayah ? '/pantau' : '/'} className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-full bg-white dark:bg-gray-900" aria-label="Kembali">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-white">{region ? `Pemantauan ${region.label}` : kab ? kab.nama : 'Pemantauan udara Indonesia'}</h1>
          <LaporButton className="ml-auto" getCenter={() => (pusat ? { lat: pusat.lat, lng: pusat.lon } : null)} />
        </header>

        {kab && <KabKotaView k={kab} latar={latar} fires={fires} wind={wind} hour={h} dark={dark} asap={asap} nama={namaKab} cctv={cctv} />}
        {!region && wilayah && !kab && indeksFile && <p className="text-sm text-gray-600 dark:text-gray-300">Wilayah tidak ditemukan. <Link to="/pantau" className="underline">Cari di daftar kabupaten/kota</Link>.</p>}

        {!region && !wilayah && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-300">Dari dinas atau puskesmas? <Link to="/pemerintah" className="font-semibold underline">Minta ringkasan mingguan</Link>. Punya sensor? <Link to="/sensor" className="font-semibold underline">Tampilkan di peta</Link>.</p>
            <label className="flex items-center gap-2 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-3">
              <span className="sr-only">Cari kabupaten atau kota</span>
              <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder={`Cari ${indeks.length ? indeks.length.toLocaleString('id-ID') : ''} kabupaten/kota`}
                className="flex-1 bg-transparent py-2.5 text-sm outline-none" data-cari-kab />
            </label>
            {hasil.length > 0 && (
              <ul className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {hasil.map((k) => (
                  <li key={k.slug}><Link to={`/pantau/${k.slug}`} className="flex justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-semibold text-gray-900 dark:text-white">{k.nama}</span><span className="text-xs text-gray-500 dark:text-gray-400">{k.provinsi}</span>
                  </Link></li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="Titik api" value={n(fires?.n)} note="24 jam, NASA FIRMS" tone={fires?.n ? 'warn' : 'neutral'} icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />} />
              <StatCard label="Provinsi terbanyak" value={prov[0]?.nama ?? '…'} note={prov[0] ? `${n(prov[0].n)} titik` : ''} icon={<MapPinned className="h-3.5 w-3.5" aria-hidden="true" />} />
              <StatCard label="Wilayah per ruas" value="2" note="Badung–Denpasar, Kota Bogor" icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />} />
              <StatCard label="Angin" value={wind ? `${wind.speed.length}` : '…'} note="titik prakiraan tiap jam" icon={<Wind className="h-3.5 w-3.5" aria-hidden="true" />} />
            </div>
            <Suspense fallback={<div className="rounded-2xl bg-gray-200/60 dark:bg-gray-800/60 animate-pulse" style={{ height: "26rem" }} />}>
              <PantauMap fires={apiSemua} luar wind={wind} hour={h} center={PUSAT_INDONESIA} zoom={5} dark={dark} kab={choropleth} jalur={jalurAsap} cctv={kameraSemua} />
            </Suspense>
            <p className="text-xs text-gray-600 dark:text-gray-300">Warna wilayah: PM2,5 latar jam ini (ketuk untuk membuka kabupaten/kotanya). Titik merah: api terdeteksi satelit dalam 24 jam terakhir (abu-abu: di negara tetangga, asapnya tetap bisa masuk). Garis putus-putus coklat: perkiraan jalur asap 24 jam dari 30 gugus api terbesar. Panah biru: arah angin.{cctv?.kamera.length ? ' Titik kecil di Bogor, Bandung, dan Yogyakarta: kamera lalu lintas (uji coba).' : ''}</p>
            <CctvRingkas file={cctv} kamera={kameraSemua} />
            {prov.length > 0 && (
              <div className="rounded-2xl bg-white dark:bg-gray-900 p-4">
                <BarChart title="Titik api 24 jam per provinsi (10 teratas)" bars={prov.slice(0, 10).map((p, i) => ({ label: p.nama, value: p.n, highlight: i === 0, color: i === 0 ? '#dc2626' : '#fb923c' }))} />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Artinya: di provinsi teratas paling banyak pembakaran atau kebakaran lahan hari ini; asapnya bisa terbawa angin ratusan kilometer.{fires?.luar_indonesia ? ` ${n(fires.luar_indonesia)} titik di negara tetangga atau laut tidak dihitung.` : ''}</p>
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
            <Suspense fallback={<div className="rounded-2xl bg-gray-200/60 dark:bg-gray-800/60 animate-pulse" style={{ height: "26rem" }} />}>
              <PantauMap fires={apiDekat} wind={wind} hour={h} center={pusatWilayah!} zoom={kameraSini.length ? 12 : 8} dark={dark} cctv={kameraSini} />
            </Suspense>
            <CctvRingkas file={cctv} kamera={kameraSini} />
            <Rincian summary="Titik api terdekat">
              {dekat.length === 0 ? <p>Tidak ada titik api dalam 150 km dalam 24 jam terakhir.</p> : (
                <ul className="space-y-1">
                  {dekat.slice(0, 10).map((d, i) => <li key={i}>{n(d.km)} km · {d.p[4].replace('T', ' ').replace('Z', ' UTC')} · daya {n(d.p[2], 1)} MW</li>)}
                </ul>
              )}
            </Rincian>
          </>
        )}
        <div className="rounded-2xl bg-white dark:bg-gray-900 p-4" data-laporan-ringkas>
          <p className="text-sm font-bold text-gray-900 dark:text-white">Laporan warga, 7 hari{region ? ' (radius 25 km)' : ''}</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900 dark:text-white" data-warga-melapor>{urgensiSini ? `${n(wargaMelapor(urgensiSini), 1)} warga melapor minggu ini` : '…'}</p>
          {mendesak.length > 0 && (
            <ol className="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-200">
              {mendesak.map((m) => (
                <li key={`${m.lat},${m.lng}`}>
                  <a className="font-semibold underline" href={`https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=15/${m.lat}/${m.lng}`} target="_blank" rel="noreferrer">sekitar {m.lat.toFixed(2)}, {m.lng.toFixed(2)}</a>
                  {' '}· {m.jenis.map((j) => JENIS_LAPOR.find((x) => x.id === j)?.label ?? j).join(', ')} · urgensi {n(m.nilai, 2)}{m.alasan.length ? ` (${m.alasan.join(', ')})` : ''}
                </li>
              ))}
            </ol>
          )}
          {laporJenis.length > 0 ? <div className="mt-2"><BarChart title="Per jenis" bars={laporJenis.map((b) => ({ ...b, color: '#b45309' }))} /></div>
            : <p className="text-xs text-gray-500 dark:text-gray-400">{lapor ? 'Belum ada laporan. Lihat asap atau pembakaran? Tekan Laporkan asap.' : 'Memuat…'}</p>}
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Hanya jumlah per wilayah; identitas pelapor tidak pernah tampil. Laporan warga tidak masuk ke angka peta.</p>
        </div>
        {(latar || wind) && (
          <p className="text-[11px] text-gray-600 dark:text-gray-300" data-jam-data>
            Data jam {jamWib(latar?.updated_at ?? wind?.updated_at)} WIB: udara latar CAMS{latar?.cams_run ? ` (run ${runWib(latar.cams_run)})` : ''} dikoreksi sensor warga jam ini; angin{wind?.run ? ` ECMWF (run ${runWib(wind.run)})` : ''}; titik api {jamWib(fires?.updated_at)} WIB. Diperbarui tiap jam.
          </p>
        )}
        <SourceLine>NASA FIRMS (VIIRS NOAA-20, NOAA-21, S-NPP), Open-Meteo, OpenStreetMap, OpenAQ, CAMS; diperbarui tiap jam.</SourceLine>
      </div>
    </main>
  );
}
