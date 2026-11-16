import { lazy, Suspense } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Seo } from '../components/Seo';
import { PRIVACY, STEPS, TRIAL_DATES, trialUrl } from '../lib/ujiCoba';

const QrImage = lazy(() => import('../components/ui/QrImage'));

/** Student trial guide (F4-01): the steps of the trial, no login, a QR code to pass the page around a class. */
export default function UjiCobaPage() {
  const navigate = useNavigate();
  const url = trialUrl(window.location.origin);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 pb-16">
      <Seo title="Uji coba siswa — Breeva" description="Langkah uji coba Breeva untuk siswa: rute sehat ke sekolah, dihitung di ponsel." path="/uji-coba" />
      <header className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Kembali" className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold">Uji coba siswa</h1>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 pt-5 space-y-5">
        <p className="text-sm leading-relaxed">
          Uji coba {TRIAL_DATES}: cari rute ke sekolah yang membuatmu menghirup lebih sedikit gas buang, dan lihat berapa
          gas buang yang kamu timbulkan bagi orang lain bila naik motor.
        </p>
        <ol className="space-y-3">
          {STEPS.map((s, k) => (
            <li key={s.title} className="flex gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-white">{k + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-[13px] text-gray-700 dark:text-gray-300">{s.body}</p>
                {s.link && <Link to={s.link.to} className="mt-1 inline-block text-[13px] font-semibold text-teal-700 dark:text-teal-300 underline underline-offset-2">{s.link.label}</Link>}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-[13px] text-gray-600 dark:text-gray-400">{PRIVACY}</p>
        <section className="flex items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <Suspense fallback={<div style={{ width: 132, height: 132 }} aria-hidden />}>
            <QrImage value={url} size={132} alt="Kode QR halaman uji coba Breeva" />
          </Suspense>
          <p className="text-[13px] text-gray-700 dark:text-gray-300">Pindai kode ini untuk membuka panduan di ponsel: <span className="break-all font-mono text-[12px]">{url}</span></p>
        </section>
      </main>
    </div>
  );
}
