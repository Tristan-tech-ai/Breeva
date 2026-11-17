import { useState } from 'react';
import { dayRows, encode, summarize } from '../../lib/trial/diary';
import { clearDiary, loadDiary, setDiaryOn } from '../../lib/trial/storage';

/**
 * The student's trial diary on /uji-coba (task F4-07): off until turned on; shows the days counted and a code to copy
 * for the teacher's questionnaire. Everything stays on the phone until the student copies the code.
 */
export default function TrialDiaryCard() {
  const [diary, setDiary] = useState(loadDiary);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const rows = dayRows(diary), s = summarize(rows);
  const code = rows.length ? encode(diary.id, rows) : null;
  const copy = () => {
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false));
  };
  const btn = 'rounded-full px-3 py-1.5 text-[13px] font-semibold';
  return (
    <section id="catatan" aria-labelledby="catatan-judul" className="rounded-xl border border-teal-700/30 bg-teal-50 dark:bg-teal-950/30 p-4 space-y-2">
      <h2 id="catatan-judul" className="text-sm font-semibold">Catatan uji cobamu</h2>
      {!diary.on ? (
        <>
          <p className="text-[13px] text-gray-700 dark:text-gray-300">
            Nyalakan supaya ponselmu mencatat hari-hari kamu memakai rute di Breeva. Yang dicatat hanya tanggal, moda, dan
            angka perbandingan rute (berapa persen asap kendaraan berkurang, berapa menit tambahannya), tanpa lokasi.
            Catatan tinggal di ponselmu sampai kamu menyalin kodenya untuk guru.
          </p>
          <button onClick={() => { setDiary(setDiaryOn(true)); setCopied(false); }} className={`${btn} bg-teal-700 text-white`}>
            Nyalakan catatan
          </button>
          {rows.length > 0 && <p className="text-[12px] text-gray-600 dark:text-gray-400">Catatan sedang mati; {s.days} hari yang sudah tercatat masih tersimpan.</p>}
        </>
      ) : (
        <p className="text-[13px] text-gray-700 dark:text-gray-300">
          Catatan menyala. Hitung rute di peta seperti biasa; setiap hari kamu memakai rute akan terhitung.
        </p>
      )}
      {rows.length > 0 ? (
        <>
          <p className="text-[13px]">
            <b>{s.days} hari</b> memakai rute ({s.lookups} kali){s.medianRed != null && <>; rute paling sedikit asap kendaraan rata-rata (median) <b>{Math.round(s.medianRed)}%</b> lebih sedikit asap, tambahan {Math.round(s.medianExtra ?? 0)} menit</>}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={copy} className={`${btn} bg-white dark:bg-gray-900 border border-teal-700 text-teal-800 dark:text-teal-200`}>
              {copied ? 'Kode disalin' : 'Salin kode ringkasan'}
            </button>
            {diary.on && <button onClick={() => setDiary(setDiaryOn(false))} className={`${btn} text-gray-600 dark:text-gray-300 underline underline-offset-2`}>Matikan catatan</button>}
            {!asking ? (
              <button onClick={() => setAsking(true)} className={`${btn} text-gray-600 dark:text-gray-300 underline underline-offset-2`}>Hapus catatan</button>
            ) : (
              <span className="text-[13px]">
                Hapus semua catatan di ponsel ini?{' '}
                <button onClick={() => { setDiary(clearDiary()); setAsking(false); setCopied(false); }} className="font-semibold text-red-700 dark:text-red-300 underline">Hapus</button>{' '}
                <button onClick={() => setAsking(false)} className="font-semibold underline">Batal</button>
              </span>
            )}
          </div>
          <label className="block text-[12px] text-gray-600 dark:text-gray-400">
            Kode untuk kuesioner guru (tempel di kolom "kode ringkasan"):
            <textarea readOnly value={code ?? ''} rows={2} aria-label="Kode ringkasan uji coba"
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 font-mono text-[11px] break-all" />
          </label>
        </>
      ) : diary.on ? (
        <p className="text-[12px] text-gray-600 dark:text-gray-400">Belum ada hari yang tercatat. Buka peta dan hitung satu rute.</p>
      ) : null}
    </section>
  );
}
