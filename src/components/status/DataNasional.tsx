import { useEffect, useState } from 'react';
import { BERKAS_NASIONAL, kesegaran, umurTeks } from '../../lib/nasional/kesegaran';

const WARNA = { segar: 'text-emerald-700 dark:text-emerald-400', tertunda: 'text-amber-700 dark:text-amber-400', 'tidak ada': 'text-gray-600 dark:text-gray-300' };

/** N-48: freshness of the national files on /status (one small request per file, after the page's own requests). */
export default function DataNasional({ base, now, awal = {} }: { base: string; now?: number; awal?: Record<string, string | null> }) {
  const [waktu, setWaktu] = useState<Record<string, string | null>>(awal);
  // the clock is read when the page mounts (and in tests passed in), not during each render
  const [kini] = useState(() => now ?? Date.now());
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      for (const b of BERKAS_NASIONAL) {
        fetch(`${base}/${b.path}`, { cache: 'no-cache' })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => alive && setWaktu((p) => ({ ...p, [b.kunci]: (j as { updated_at?: string } | null)?.updated_at ?? null })))
          .catch(() => alive && setWaktu((p) => ({ ...p, [b.kunci]: null })));
      }
    }, 800);
    return () => { alive = false; clearTimeout(t); };
  }, [base]);
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3" data-nasional-segar>
      <h2 className="text-sm font-bold text-gray-900 dark:text-white">Data nasional (/pantau)</h2>
      <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800 text-[13px]">
        {BERKAS_NASIONAL.map((b) => {
          const ada = b.kunci in waktu;
          const k = kesegaran(waktu[b.kunci], kini, b.batasMenit);
          return (
            <li key={b.kunci} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5" data-berkas={b.kunci}>
              <span className="text-gray-800 dark:text-gray-100">{b.label}{b.catatan && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{b.catatan}</span>}</span>
              <span className={`font-semibold ${ada ? WARNA[k.status] : 'text-gray-500 dark:text-gray-400'}`}>
                {ada ? `${k.status === 'segar' ? 'Segar' : k.status === 'tertunda' ? 'Tertunda' : 'Tidak terbaca'} · ${umurTeks(k.umurMenit)}` : 'memuat…'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Dihitung ulang tiap jam di AWS (kamera tiap 20 menit). Segar: di bawah 2 jam (kamera 1 jam).</p>
    </section>
  );
}
