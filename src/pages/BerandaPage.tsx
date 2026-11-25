import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Flame, Footprints, Landmark, Radio, School, Timer } from 'lucide-react';
import { Seo } from '../components/Seo';
import StatCard from '../components/viz/StatCard';
import { FIELD_REGIONS, fieldBase } from '../lib/field/source';
import { berandaAngka, type BerandaAngka } from '../lib/beranda';

const PINTU = [
  { to: '/peta', icon: Footprints, judul: 'Untuk warga', isi: 'Pilih jalan dengan asap kendaraan paling sedikit', cta: 'Buka peta' },
  { to: '/prioritas', icon: School, judul: 'Sekolah dan orang tua', isi: 'Sekolah dan puskesmas yang paling terpapar', cta: 'Lihat daftar' },
  { to: '/pantau', icon: Landmark, judul: 'Pemerintah daerah', isi: 'Titik api, angin, laporan warga, grafik', cta: 'Buka pemantauan' },
] as const;

const fmt = (v: number | null) => (v == null ? '…' : v.toLocaleString('id-ID'));

/** `/` for visitors (N-02): one picture of the live map, one sentence, three live numbers and three doors. */
export default function BerandaPage() {
  const [angka, setAngka] = useState<BerandaAngka>({ sensor: null, titikApi: null, jamTerbit: null });
  useEffect(() => {
    let alive = true;
    const b = fieldBase();
    const get = (p: string) => fetch(`${b}${p}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([
      Promise.all(FIELD_REGIONS.map((r) => get(`/v/${r.name}/manifest.json`))),
      Promise.all(FIELD_REGIONS.map((r) => get(`/v/${r.name}/runs_recent.json`))),
      get('/v/nasional/titik_api.json'),
    ]).then(([m, runs, fire]) => alive && setAngka(berandaAngka(m, runs, fire, new Date())));
    return () => { alive = false; };
  }, []);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-emerald-50 to-white dark:from-gray-950 dark:to-gray-900">
      <Seo title="Breeva: peta asap kendaraan per ruas jalan" description="Peta asap kendaraan per ruas jalan tiap jam, daftar sekolah yang paling terpapar, titik api dan laporan warga. Tanpa akun." path="/" />
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-10">
        <header className="flex items-center justify-between">
          <span className="text-lg font-extrabold tracking-tight text-emerald-800 dark:text-emerald-300">Breeva</span>
          <Link to="/login" className="min-h-9 inline-flex items-center rounded-full px-3 text-sm font-semibold text-emerald-800 dark:text-emerald-300">Masuk</Link>
        </header>

        <Link to="/peta" className="mt-4 block overflow-hidden rounded-3xl border border-emerald-100 dark:border-gray-800 shadow-sm" aria-label="Buka peta hidup">
          <img src="/beranda-peta.webp" alt="Peta Denpasar: jalan besar berwarna ungu pekat karena asap kendaraan, gang berwarna terang" width={690} height={478}
            className="w-full h-auto" fetchPriority="high" />
        </Link>

        <h1 className="mt-5 text-2xl sm:text-3xl font-extrabold leading-tight text-gray-900 dark:text-white">
          Asap kendaraan per ruas jalan, diperbarui tiap jam.
        </h1>
        <p className="mt-2 text-base text-gray-600 dark:text-gray-300">Pilih jalan yang lebih bersih, lindungi sekolah, laporkan sumber asap.</p>

        <div className="mt-5 grid grid-cols-3 gap-2" aria-live="polite">
          <StatCard label="Sensor warga" value={fmt(angka.sensor)} note="aktif jam ini" icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />} />
          <StatCard label="Titik api" value={fmt(angka.titikApi)} note="Indonesia, 24 jam" tone={angka.titikApi ? 'warn' : 'neutral'} icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />} />
          <StatCard label="Peta terbit" value={angka.jamTerbit == null ? '…' : `${angka.jamTerbit}/24`} note="jam terakhir" tone={angka.jamTerbit != null && angka.jamTerbit >= 23 ? 'good' : 'neutral'} icon={<Timer className="h-3.5 w-3.5" aria-hidden="true" />} />
        </div>

        <nav className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Mulai dari">
          {PINTU.map(({ to, icon: Icon, judul, isi, cta }) => (
            <Link key={to} to={to} className="group rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-4 shadow-sm hover:border-emerald-300">
              <Icon className="h-6 w-6 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
              <h2 className="mt-2 text-base font-bold text-gray-900 dark:text-white">{judul}</h2>
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{isi}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">{cta}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
            </Link>
          ))}
        </nav>

        <p className="mt-6 text-sm">
          <Link to="/validasi" className="font-semibold text-emerald-800 dark:text-emerald-300 underline underline-offset-2">Seberapa akurat?</Link>
          <span className="text-gray-500 dark:text-gray-400"> Diuji di lokasi sensor yang disembunyikan, dengan target EPA.</span>
        </p>
        <footer className="mt-8 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>Data terbuka: OpenStreetMap, OpenAQ, NASA FIRMS, Open-Meteo dan CAMS</span>
          <Link to="/about" className="underline">Tentang</Link>
          <Link to="/privacy" className="underline">Privasi</Link>
          <Link to="/status" className="underline">Status data</Link>
        </footer>
      </div>
    </main>
  );
}
