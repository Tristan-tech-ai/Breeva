import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Download, Flame, Landmark, Printer, School } from 'lucide-react';
import { Seo } from '../components/Seo';
import Rincian from '../components/viz/Rincian';
import { fieldBase } from '../lib/field/source';
import { bacaIndeks, cariKabKota, type KabKota, type KabKotaIndeks } from '../lib/nasional/kabkota';
import { emailSah, mintaRingkasan, PERTANYAAN_MASUKAN, type DinasHasil } from '../lib/dinas';

const PESAN: Record<string, string> = {
  instansi: 'Tulis nama instansi.', wilayah: 'Pilih kabupaten/kota dari daftar.', email: 'Alamat email belum benar.',
  batas: 'Sedang banyak permintaan; coba lagi satu jam lagi.', jaringan: 'Tidak tersambung. Coba lagi.', konfigurasi: 'Formulir belum bisa dipakai di versi ini.',
};

/** N-28: what an agency gets from Breeva, a request for a weekly summary, and the feedback sheet. No login. */
export default function PemerintahPage() {
  const [indeks, setIndeks] = useState<KabKota[]>([]);
  useEffect(() => {
    fetch(`${fieldBase()}/v/nasional/kabkota_indeks.json`).then((r) => (r.ok ? r.json() : null)).then((j: KabKotaIndeks | null) => setIndeks(bacaIndeks(j))).catch(() => {});
  }, []);
  const [instansi, setInstansi] = useState('');
  const [cari, setCari] = useState('');
  const [wilayah, setWilayah] = useState<KabKota | null>(null);
  const [email, setEmail] = useState('');
  const [kirim, setKirim] = useState(false);
  const [hasil, setHasil] = useState<DinasHasil | null>(null);
  const pilihan = useMemo(() => (wilayah ? [] : cariKabKota(indeks, cari, 6)), [indeks, cari, wilayah]);
  const siap = instansi.trim().length >= 3 && !!wilayah && emailSah(email);
  const go = async () => {
    if (!siap || !wilayah) return;
    setKirim(true);
    setHasil(await mintaRingkasan({ instansi, wilayah: wilayah.slug, email }));
    setKirim(false);
  };
  const kartu: Array<[typeof Landmark, string, string, string]> = [
    [Landmark, 'Pemantauan per kabupaten/kota', 'Udara latar 48 jam, titik api, arah angin, asap menuju, laporan warga, unduh CSV. 513 kabupaten/kota.', '/pantau'],
    [School, 'Sekolah dan faskes paling terpapar', 'Daftar urut asap kendaraan pada jam kegiatan, dengan simulasi tutup jalan depan gerbang (Badung–Denpasar, Kota Bogor).', '/prioritas'],
    [Flame, 'Seberapa akurat', 'Uji di lokasi yang disembunyikan dengan target EPA; yang belum lolos ditulis apa adanya.', '/validasi'],
  ];
  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Seo title="Untuk pemerintah daerah · Breeva" description="Data udara per kabupaten/kota, daftar sekolah dan faskes paling terpapar, ringkasan mingguan untuk dinas. Tanpa biaya." path="/pemerintah" />
      <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
        <header className="flex items-center gap-2 print:hidden">
          <Link to="/" className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-full bg-white dark:bg-gray-900" aria-label="Kembali"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>
          <h1 className="text-lg font-extrabold">Untuk pemerintah daerah</h1>
        </header>
        <p className="text-sm text-gray-700 dark:text-gray-200 print:hidden">Mulai dari mana: jalan, sekolah, dan wilayah yang paling berasap. Tanpa akun dan tanpa biaya.</p>
        <section className="grid gap-3 sm:grid-cols-3 print:hidden">
          {kartu.map(([Icon, judul, isi, to]) => (
            <Link key={to} to={to} className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4">
              <Icon className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <p className="mt-2 text-sm font-bold">{judul}</p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{isi}</p>
            </Link>
          ))}
        </section>

        <section className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 space-y-3 print:hidden" data-form-dinas>
          <h2 className="text-base font-bold">Minta ringkasan mingguan</h2>
          {hasil?.ok ? (
            <p className="text-sm text-emerald-800 dark:text-emerald-300" role="status">
              {hasil.sudah ? 'Permintaan untuk email dan wilayah ini sudah tercatat sebelumnya.' : 'Permintaan tercatat.'} Tim Breeva membalas ke email
              tersebut; ringkasan mingguan belum dikirim otomatis.
            </p>
          ) : (
            <>
              <label className="block text-xs font-semibold">Nama instansi
                <input value={instansi} onChange={(e) => setInstansi(e.target.value.slice(0, 120))} placeholder="mis. Dinas Lingkungan Hidup Kota Bogor"
                  className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" />
              </label>
              <div className="text-xs font-semibold">
                <label htmlFor="dinas-wilayah">Kabupaten/kota</label>
                {wilayah ? (
                  <p className="mt-1 flex items-center justify-between rounded-xl bg-emerald-50 dark:bg-emerald-900/30 p-2 text-sm font-normal">
                    <span>{wilayah.nama}, {wilayah.provinsi}</span>
                    <button type="button" onClick={() => { setWilayah(null); setCari(''); }} className="min-h-8 px-2 text-xs font-semibold underline">ganti</button>
                  </p>
                ) : (
                  <>
                    <input id="dinas-wilayah" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="ketik nama kabupaten/kota"
                      className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" />
                    {pilihan.length > 0 && (
                      <ul className="mt-1 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                        {pilihan.map((k) => <li key={k.slug}><button type="button" onClick={() => setWilayah(k)} className="w-full min-h-9 px-2 text-left text-sm font-normal">{k.nama} <span className="text-gray-500 dark:text-gray-400">· {k.provinsi}</span></button></li>)}
                      </ul>
                    )}
                  </>
                )}
              </div>
              <label className="block text-xs font-semibold">Email instansi
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value.slice(0, 200))} placeholder="nama@instansi.go.id"
                  className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" />
              </label>
              {hasil && !hasil.ok && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{PESAN[hasil.alasan]}</p>}
              <button onClick={go} disabled={!siap || kirim} className="w-full min-h-11 rounded-2xl bg-emerald-700 font-bold text-white disabled:opacity-50">{kirim ? 'Mengirim…' : 'Kirim permintaan'}</button>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Email hanya dipakai untuk membalas permintaan ini, tidak ditampilkan dan tidak dibagikan.</p>
            </>
          )}
        </section>

        <section className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 space-y-2" data-lembar-masukan>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold">Lembar masukan instansi</h2>
            <button onClick={() => window.print()} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 px-3 text-xs font-semibold print:hidden">
              <Printer className="h-4 w-4" aria-hidden="true" />Cetak
            </button>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">Diisi sesudah peragaan singkat (10–15 menit) di puskesmas atau dinas. Boleh tanpa nama.</p>
          <ol className="list-decimal pl-5 space-y-3 text-sm">
            {PERTANYAAN_MASUKAN.map((q) => <li key={q}>{q}<span className="block border-b border-dotted border-gray-400 h-6" aria-hidden="true" /></li>)}
          </ol>
          <p className="text-xs text-gray-600 dark:text-gray-300 pt-2">Tanda tangan dan stempel (bila berkenan):</p>
        </section>

        <Rincian summary="Data yang bisa diunduh" className="print:hidden">
          <ul className="space-y-1">
            <li><Download className="inline h-3.5 w-3.5" aria-hidden="true" /> Per kabupaten/kota: udara latar 48 jam dan titik api (CSV) di halaman /pantau/&lt;kabupaten-kota&gt;.</li>
            <li><Download className="inline h-3.5 w-3.5" aria-hidden="true" /> Daftar prioritas sekolah dan faskes (CSV) di /pantau/badung-denpasar dan /pantau/kota-bogor.</li>
            <li>Sumber: OpenStreetMap (ODbL), NASA FIRMS, CAMS dan ECMWF lewat Open-Meteo (CC BY 4.0), sensor warga OpenAQ (CC BY 4.0).</li>
          </ul>
        </Rincian>
      </div>
    </main>
  );
}
