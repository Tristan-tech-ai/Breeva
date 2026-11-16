import { useEffect, useState } from 'react';
import { fieldBase } from '../../lib/field/source';
import { summarizeRecent, type RecentFile } from '../../lib/field/validationRecent';
import { num, pct } from '../../lib/validasi';

/**
 * Running hourly hidden-sensor test of the live map (task F5-09), read from the file the hourly builder writes. Hourly
 * numbers, labelled as such: the EPA target applies to 24-hour means.
 */
export default function RunningValidation({ region = 'badung_denpasar', label = 'Badung–Denpasar' }: { region?: string; label?: string }) {
  const [f, setF] = useState<RecentFile | null | 'failed'>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${fieldBase()}/v/${region}/validation_recent.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RecentFile) => alive && setF(d))
      .catch(() => alive && setF('failed'));
    return () => { alive = false; };
  }, [region]);

  const s = f && f !== 'failed' ? summarizeRecent(f) : null;
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm space-y-1">
      <h2 className="font-semibold">Uji berjalan di peta hidup ({label})</h2>
      {!f && <p className="text-gray-500">Memuat…</p>}
      {(f === 'failed' || (f && !s)) && <p className="text-gray-500">Belum ada jam yang diuji.</p>}
      {s && (
        <>
          <p>
            Setiap jam, tiap sensor warga disembunyikan bergiliran dan ditebak dari sensor lain. Dari {s.hours} jam terakhir:
            NRMSE per jam median {pct(s.median_nrmse)} (RMSE {num(s.median_rmse, 1)} µg/m³), rentang 95% memuat {pct(s.median_coverage)} bacaan
            yang disembunyikan, median {num(s.sensors_median, 0)} sensor per jam.
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Angka per jam, belum dibandingkan dengan target EPA: target NRMSE ≤ 30% berlaku untuk rata-rata 24 jam.
          </p>
          <p className="text-[11px] text-gray-500">Sumber: v/{region}/validation_recent.json, run terakhir {s.last_run}.</p>
        </>
      )}
    </section>
  );
}
