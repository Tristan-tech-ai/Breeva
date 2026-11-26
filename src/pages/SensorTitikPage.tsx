import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, Download } from 'lucide-react';
import { Seo } from '../components/Seo';
import Rincian from '../components/viz/Rincian';
import BarChart from '../components/viz/BarChart';
import { useIsDark } from '../stores/settingsStore';
import { formatAngka } from '../lib/angka';
import { csvTitik, jenisKata, kalimatTitik, WILAYAH_TITIK, type DataTitik } from '../lib/sensorTitik';

const PetaTitik = lazy(() => import('../components/sensor/PetaTitik'));

/**
 * M-T06 (Rencana Induk 2, INTI): where new sensors open the most of the map's blindness, per pilot region. The fog is
 * B(x) = people x (1 + schools and clinics) x level x expected error; the pins are the greedy picks of
 * D:/breeva-ml-data/titik_sensor/titik.py. Labelled "indikatif" while the method test (M-T01) has not passed.
 */
export default function SensorTitikPage() {
  const navigate = useNavigate();
  const dark = useIsDark();
  const [wil, setWil] = useState<string>(() => (new URLSearchParams(window.location.search).get('wilayah') === 'kota_bogor' ? 'kota_bogor' : 'badung_denpasar'));
  const [data, setData] = useState<DataTitik | null>(null);
  const [galat, setGalat] = useState('');
  const [pilih, setPilih] = useState<number | null>(1);
  useEffect(() => {
    let batal = false;
    fetch(`/data/titik_sensor/${wil}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DataTitik) => { if (!batal) setData(d); }).catch((e: Error) => { if (!batal) setGalat(e.message); });
    return () => { batal = true; };
  }, [wil]);
  const onPilih = useCallback((n: number) => setPilih(n), []);
  const label = WILAYAH_TITIK.find((w) => w.name === wil)?.label ?? wil;
  const titik = data?.titik.find((t) => t.peringkat === pilih) ?? null;
  const unduh = useMemo(() => (data ? URL.createObjectURL(new Blob([csvTitik(data)], { type: 'text/csv;charset=utf-8' })) : ''), [data]);
  useEffect(() => () => { if (unduh) URL.revokeObjectURL(unduh); }, [unduh]);

  return (
    <div className="min-h-screen bg-gray-50 pb-16 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Seo title="Titik sensor berikutnya — Breeva" description="Di mana sensor udara baru paling membuka kebutaan peta: Badung–Denpasar dan Kota Bogor, ditimbang menurut orang, sekolah, dan faskes." path="/sensor/titik" />
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <button onClick={() => navigate(-1)} aria-label="Kembali" className="-ml-1.5 rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="truncate text-base font-semibold">Titik sensor berikutnya</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-3 px-4 pt-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Wilayah">
          {WILAYAH_TITIK.map((w) => (
            <button key={w.name} aria-pressed={wil === w.name} onClick={() => { if (w.name === wil) return; setData(null); setGalat(''); setPilih(1); setWil(w.name); }}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${wil === w.name ? 'bg-sky-700 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
              {w.label}
            </button>
          ))}
        </div>
        {galat && <p className="text-sm text-red-700 dark:text-red-300">Data titik sensor gagal dimuat ({galat}).</p>}
        {data && (
          <>
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-snug text-amber-900 dark:bg-amber-900/30 dark:text-amber-100" data-label-titik>
              <b>{data.uji_metode.teruji ? 'Teruji' : 'Indikatif'}.</b>{' '}
              {data.uji_metode.teruji
                ? 'Aturan penempatan lolos uji ulang pada 28 sensor Bali.'
                : `Pada 28 sensor Bali, aturan ini lebih baik dari urutan acak pada ${data.uji_metode.lolos_urutan_dari_9} dari 9 uji, tetapi besar manfaat tiap titik belum teramalkan (korelasi ${formatAngka(data.uji_metode.spearman, 2, 2)}).`}
            </p>
            <p className="text-[13px] leading-snug">
              {data.sensor_ada > 0
                ? `${label}: ${data.sensor_ada} sensor warga sekarang. ${formatAngka(data.cakupan['>2 km'].bangunan_pct, 1, 1)}% luas bangunan dan ${data.fasilitas_jarak['>2 km']} dari ${data.fasilitas_jarak.total} sekolah dan faskes berjarak lebih dari 2 km dari sensor.`
                : `${label}: belum ada sensor. Semua ${data.fasilitas_jarak.total} sekolah dan faskes berjarak lebih dari 2 km dari titik ukur, jadi angka peta di sini indikatif.`}
            </p>
            <Suspense fallback={<div className="animate-pulse rounded-2xl bg-gray-200/60 dark:bg-gray-800/60" style={{ height: 'min(60svh, 520px)' }} />}>
              <PetaTitik data={data} dark={dark} pilih={pilih} onPilih={onPilih} />
            </Suspense>
            <p className="text-[12px] text-gray-700 dark:text-gray-300">Oranye pekat: tempat peta paling buta bagi orang yang tinggal dan bersekolah di sana. Titik biru: sensor yang ada. Angka hijau: titik sensor berikutnya, ketuk untuk rinciannya.</p>
            {titik && (
              <section className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" aria-live="polite" data-kartu-titik>
                <p className="text-sm font-bold">{titik.peringkat}. {titik.nama} <span className="font-medium text-gray-700 dark:text-gray-300">({jenisKata(titik.jenis)})</span></p>
                <p className="mt-1 text-[13px] leading-snug">{kalimatTitik(titik)}</p>
                <a className="mt-1 inline-block text-[12px] font-semibold text-sky-800 underline dark:text-sky-300" href={`https://www.openstreetmap.org/?mlat=${titik.lat}&mlon=${titik.lon}#map=18/${titik.lat}/${titik.lon}`} target="_blank" rel="noreferrer">Lihat lokasinya di OpenStreetMap</a>
              </section>
            )}
            <BarChart title={`${data.titik.length} titik pertama membuka ${formatAngka(data.kurva_manfaat_pct[data.kurva_manfaat_pct.length - 1] ?? 0, 1, 1)}% kabut kebutaan (kumulatif)`}
              bars={data.titik.map((t, k) => ({ label: `${t.peringkat}. ${t.nama}`, value: data.kurva_manfaat_pct[k], valueLabel: `${formatAngka(data.kurva_manfaat_pct[k], 1, 1)}%`, color: '#15803d' }))} max={100} />
            <ol className="space-y-1" aria-label="Daftar titik">
              {data.titik.map((t) => (
                <li key={t.peringkat}>
                  <button type="button" onClick={() => setPilih(t.peringkat)} aria-pressed={pilih === t.peringkat}
                    className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-[13px] ${pilih === t.peringkat ? 'bg-emerald-50 ring-1 ring-emerald-700 dark:bg-emerald-900/30' : 'bg-white dark:bg-gray-900'}`}>
                    <b>{t.peringkat}.</b> {t.nama} · +{formatAngka(t.dJ_marginal_pct, 1, 1)}%{t.jarak_sensor_terdekat_km != null ? ` · ${formatAngka(t.jarak_sensor_terdekat_km, 1, 1)} km dari sensor` : ''}
                  </button>
                </li>
              ))}
            </ol>
            <a href={unduh} download={`titik_sensor_${wil}.csv`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-sky-800 px-4 text-[13px] font-semibold text-sky-900 dark:border-sky-300 dark:text-sky-200">
              <Download className="h-4 w-4" aria-hidden /> Unduh daftar (CSV)
            </a>
            <Rincian summary="Cara membaca dan cara menghitung">
              <div className="space-y-2 text-[13px] leading-snug">
                <p>Kebutaan sebuah tempat = berapa orang di sana (luas bangunan OpenStreetMap), ditambah bobot untuk sekolah dan faskes dalam 500 m, dikali kadar udara dan galat perkiraan per jam di tempat itu. Galat perkiraan dihitung dari jarak dan kemiripan sensor (kriging), lalu dikalibrasi dengan sensor yang disembunyikan.</p>
                <p>Titik dipilih satu per satu: tiap langkah memilih sekolah, faskes, atau kantor desa (paling dekat 50 m dari jalan utama, antar titik baru paling dekat 500 m) yang paling banyak membuka kabut. Dua titik pertama hasil cara ini {formatAngka(data.cek_dua_titik.greedy_pct, 2, 2)}%, sama dengan pencarian semua pasangan ({formatAngka(data.cek_dua_titik.terbaik_lengkap_pct, 2, 2)}%).</p>
                <p>Peringkat peka terhadap cara menimbang: dengan bobot penduduk saja, {data.kepekaan.utama_vs_penduduk} dari {data.kepekaan.pembanding_n} titik teratas sama. Karena itu daftar ini usulan awal untuk dibahas bersama dinas dan sekolah, bukan keputusan akhir.</p>
                <p>Sumber: bangunan dan fasilitas OpenStreetMap (ODbL), sensor warga OpenAQ (AirGradient, CC BY 4.0), daftar prioritas Breeva. Galat per jam median {formatAngka(data.e_median, 1, 1)} µg/m³ sekarang.</p>
              </div>
            </Rincian>
            <p className="text-[12px] text-gray-700 dark:text-gray-300">
              <Link to="/validasi" className="font-semibold text-sky-800 underline dark:text-sky-300">Cara kami menguji akurasi</Link> ·{' '}
              <Link to="/pemerintah" className="font-semibold text-sky-800 underline dark:text-sky-300">Halaman pemerintah daerah</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
