import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Seo } from '../components/Seo';
import { findCodes, rekap } from '../lib/trial/diary';
import { rekapRows, windowOf } from '../lib/trial/rekapView';

/**
 * The teacher's tally of the student trial (task F4-09): paste the answers that hold BRV1 codes (a Google Form column
 * or a chat) and the counts gate G4 needs are computed on this device. Nothing is sent anywhere.
 */
export default function UjiCobaRekapPage() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [from, setFrom] = useState('2026-11-26');
  const [to, setTo] = useState('2026-12-02');
  const [copied, setCopied] = useState(false);
  const win = windowOf(from, to);
  const result = win ? rekap(findCodes(text), win) : null; // a few dozen short codes: cheap on every keystroke
  const copy = () => {
    if (!result) return;
    navigator.clipboard?.writeText(JSON.stringify(result, null, 1)).then(() => setCopied(true), () => setCopied(false));
  };
  const input = 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-[13px]';
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 pb-16">
      <Seo title="Rekap uji coba — Breeva" description="Rekap kode ringkasan uji coba Breeva untuk guru, dihitung di perangkat." path="/uji-coba/rekap" />
      <header className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800 print:hidden">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Kembali" className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold">Rekap uji coba (untuk guru)</h1>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 pt-5 space-y-4">
        {/* printed copy for the teacher's report (F4-15): title, window and date; the paste box and buttons stay off paper */}
        <div className="hidden print:block">
          <h1 className="text-lg font-bold">Rekap uji coba Breeva</h1>
          <p className="text-[12px]">Hari dihitung {from} sampai {to} · dicetak {new Date().toLocaleDateString('id-ID', { dateStyle: 'long' })}</p>
        </div>
        <p className="text-sm leading-relaxed print:hidden">
          Tempel jawaban kuesioner akhir yang berisi kode ringkasan (kode diawali BRV1-; boleh satu kolom, satu berkas CSV
          utuh, atau pesan chat). Hitungannya dibuat di perangkat ini dan tidak dikirim ke mana pun.
        </p>
        <label className="block text-[13px] font-semibold print:hidden">
          Jawaban atau kode
          <textarea value={text} onChange={(e) => { setText(e.target.value); setCopied(false); }} rows={7} aria-label="Jawaban berisi kode ringkasan"
            placeholder="BRV1-..." className={`mt-1 block w-full font-mono text-[12px] ${input}`} />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-[13px] print:hidden">
          <span>Hari dihitung dari</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Tanggal mulai" className={input} />
          <span>sampai</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Tanggal akhir" className={input} />
        </div>
        {!win && <p className="text-[13px] text-red-700 dark:text-red-300">Tanggal mulai harus sebelum atau sama dengan tanggal akhir.</p>}
        {result && result.kode_terbaca + result.kode_ditolak > 0 && (
          <section aria-label="Hasil rekap" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <dl className="divide-y divide-gray-100 dark:divide-gray-800">
              {rekapRows(result).map((r) => (
                <div key={r.label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
                  <dt className="text-[13px] text-gray-600 dark:text-gray-400">{r.label}</dt>
                  <dd className="text-[13px] font-semibold sm:text-right">{r.value}</dd>
                </div>
              ))}
            </dl>
            <button onClick={copy} className="mt-3 min-h-8 rounded-full border border-teal-700 px-3 py-1.5 text-[13px] font-semibold text-teal-800 dark:text-teal-200 print:hidden">
              {copied ? 'Hasil disalin' : 'Salin hasil (JSON) untuk laporan'}
            </button>
          </section>
        )}
        <p className="text-[12px] text-gray-600 dark:text-gray-400">
          Kode hanya memuat tanggal, moda, wilayah, dan angka perbandingan rute; tidak memuat nama atau lokasi. Pengurangan
          asap adalah yang ditawarkan rute paling sedikit asap kendaraan dibanding rute tercepat, bukan dosis yang terukur;
          apakah siswa benar-benar lewat rute itu ditanyakan di kuesioner. Kode dari ponsel yang sama dihitung sekali.
        </p>
        <Link to="/uji-coba" className="print:hidden inline-block min-h-6 py-0.5 text-[13px] font-semibold text-teal-700 dark:text-teal-300 underline underline-offset-2">Kembali ke panduan uji coba</Link>
      </main>
    </div>
  );
}
