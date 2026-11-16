import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, School, Stethoscope, Search, Info, MapPin } from 'lucide-react';
import { Seo } from '../components/Seo';
import { fmt, JALAN, JENIS, rentangJam, saringUrut, type DaftarPrioritas, type Saring } from '../lib/prioritas';
import { CAMS_NOTICE, OPEN_METEO_LINK } from '../lib/attribution';
import { destLink } from '../lib/route/share';

const DATA_URL = '/data/prioritas/badung_denpasar.json';

export default function PrioritasPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DaftarPrioritas | null>(null);
  const [gagal, setGagal] = useState(false);
  const [saring, setSaring] = useState<Saring>({ kelas: 'semua', cari: '', urutan: 'lalin' });

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DaftarPrioritas) => setData(d))
      .catch(() => setGagal(true));
  }, []);

  const list = useMemo(() => (data ? saringUrut(data.fasilitas, saring) : []), [data, saring]);
  const maxLalin = useMemo(() => Math.max(0.01, ...(data?.fasilitas.map((f) => f.pm25_lalin) ?? [0])), [data]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 pb-16">
      <Seo title="Prioritas sekolah dan fasilitas kesehatan — Badung–Denpasar" description="Sekolah dan fasilitas kesehatan di Badung–Denpasar diurutkan menurut polusi lalu lintas yang diperkirakan mereka hirup pada jam kegiatan." path="/prioritas" />

      <header className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Kembali" className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold">Prioritas fasilitas · Badung–Denpasar</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-5 space-y-5">
        <section className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            Sekolah, TK, penitipan anak, klinik, dan rumah sakit diurutkan menurut <b>PM2,5 dari lalu lintas jalan di sekitarnya</b> yang
            diperkirakan terhirup pada jam kegiatan. Bagian ini berbeda tajam dari satu fasilitas ke fasilitas lain dan bisa diubah
            dengan kebijakan jalan dan sekolah. Polusi latar wilayah ditampilkan terpisah.
          </p>
          {data && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Perkiraan untuk {new Date(`${data.tanggal}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ({data.zona}),
              dihitung {new Date(data.dibuat).toLocaleString('id-ID')} dari {data.ruas.toLocaleString('id-ID')} ruas jalan.
              {' '}{data.ringkasan.lalin_di_atas_1} fasilitas mendapat lebih dari 1 µg/m³ dari lalu lintas sekitar;
              {' '}{data.ringkasan.lalin_di_atas_0_5} lebih dari 0,5 µg/m³.
            </p>
          )}
        </section>

        <section className="flex flex-col sm:flex-row gap-2">
          <div className="flex rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden text-sm" role="group" aria-label="Jenis fasilitas">
            {(['semua', 'pendidikan', 'kesehatan'] as const).map((k) => (
              <button key={k} onClick={() => setSaring((s) => ({ ...s, kelas: k }))}
                className={`px-3 py-2 capitalize ${saring.kelas === k ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-900'}`}>
                {k}
              </button>
            ))}
          </div>
          <label className="flex-1 flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3">
            <Search className="w-4 h-4 text-gray-400" />
            <input value={saring.cari} onChange={(e) => setSaring((s) => ({ ...s, cari: e.target.value }))}
              placeholder="Cari nama fasilitas" className="flex-1 bg-transparent py-2 text-sm outline-none" />
          </label>
          <select value={saring.urutan} onChange={(e) => setSaring((s) => ({ ...s, urutan: e.target.value as Saring['urutan'] }))}
            aria-label="Urutkan" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm">
            <option value="lalin">Urut: dari lalu lintas</option>
            <option value="total">Urut: PM2,5 total</option>
            <option value="jarak">Urut: jarak ke jalan ramai</option>
            <option value="nama">Urut: nama</option>
          </select>
        </section>

        {gagal && <p className="text-sm text-red-600">Data prioritas tidak bisa dimuat.</p>}
        {!data && !gagal && <p className="text-sm text-gray-500">Memuat…</p>}

        {data && (
          <ol className="space-y-2" aria-label="Daftar fasilitas">
            {list.map((f) => {
              const Icon = f.kelas === 'pendidikan' ? School : Stethoscope;
              return (
                <li key={f.id} className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-3.5">
                  <div className="flex items-start gap-3">
                    <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-400">#{f.peringkat}</span>
                    <Icon className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">{f.nama}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {JENIS[f.jenis] ?? f.jenis} · {f.d_ramai_m} m dari {JALAN[f.jalan_terdekat] ?? f.jalan_terdekat} · jam {rentangJam(f.jam)}
                      </p>
                      <p className="mt-2 text-xs tabular-nums"><b className="text-sm">{fmt(f.pm25_lalin, 2)}</b> µg/m³ PM2,5 dari lalu lintas sekitar</p>
                      <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden" aria-hidden>
                        <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(1, Math.min(100, (f.pm25_lalin / maxLalin) * 100))}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                        NO₂ dari lalu lintas {fmt(f.no2_lalin)} µg/m³ · PM2,5 total {fmt(f.pm25)} µg/m³ (rentang 95%: ±{fmt(f.pi95, 0)}) · puncak jam {String(f.jam_puncak).padStart(2, '0')}.00
                      </p>
                    </div>
                    <Link to={destLink('/peta', { lat: f.lat, lng: f.lon, name: f.nama })} aria-label={`Rute ke ${f.nama}`}
                      className="shrink-0 self-start rounded-lg px-2 py-1 text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/30">
                      Rute ke sini
                    </Link>
                    <a href={`https://www.openstreetmap.org/${f.id}`} target="_blank" rel="noreferrer" aria-label={`Lokasi ${f.nama} di peta`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-gray-800">
                      <MapPin className="w-4 h-4" />
                    </a>
                  </div>
                </li>
              );
            })}
            {list.length === 0 && <p className="text-sm text-gray-500">Tidak ada fasilitas yang cocok.</p>}
          </ol>
        )}

        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2 text-sm leading-relaxed">
          <h2 className="font-semibold flex items-center gap-2"><Info className="w-4 h-4" /> Cara menghitung dan batasannya</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-gray-600 dark:text-gray-300">
            <li><b>Di titik fasilitas.</b> Nilai dihitung di lokasi fasilitas (OpenStreetMap), bukan di ruas jalan terdekat: sebaran
              CALINE4 dari 40 ruas terdekat dalam 500 m, dengan arus kendaraan menurut kelas jalan dan pola jam, ditambah latar CAMS
              (prakiraan Open-Meteo per jam).</li>
            <li><b>Jam kegiatan.</b> Sekolah 07.00–14.00, TK/PAUD 07.00–12.00, penitipan anak 07.00–17.00, klinik 08.00–16.00,
              rumah sakit 24 jam. Angka adalah rata-rata jam-jam itu untuk satu hari prakiraan.</li>
            <li><b>Kenapa diurutkan menurut lalu lintas.</b> Rentang 95% PM2,5 total sekitar ±23 µg/m³, lebih lebar dari selisih
              total antarfasilitas, jadi total tidak bisa mengurutkan mereka. Bagian dari lalu lintas sekitar dihitung dengan fisika
              yang sama untuk semua fasilitas, sehingga urutannya bermakna sebagai perbandingan.</li>
            <li><b>Nilai mutlak belum divalidasi.</b> Belum ada koreksi dari sensor; model latar cenderung lebih rendah dari
              pengukuran stasiun di Bali. Jangan memakai angka ini sebagai hasil ukur.</li>
            <li><b>Belum termasuk</b> pembakaran terbuka, sumber industri, dan arus lalu lintas terukur; arus memakai perkiraan per
              kelas jalan. Daftar fasilitas mengikuti data OpenStreetMap dalam kotak Badung–Denpasar dan bisa belum lengkap.</li>
          </ul>
          {data && (
            <p className="text-xs text-gray-400">
              Mesin: {data.mesin}. Geometri jalan versi {data.geometri}. Data jalan dan fasilitas © kontributor OpenStreetMap (ODbL).
              {' '}Data cuaca dan latar: <a className="underline" href={OPEN_METEO_LINK} target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0).
              {' '}{CAMS_NOTICE}.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
