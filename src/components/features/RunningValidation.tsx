import { useEffect, useState } from 'react';
import { fieldBase } from '../../lib/field/source';
import { pooledDaily, summarizeRecent, type RecentFile } from '../../lib/field/validationRecent';
import { num, pct, type SingleDay } from '../../lib/validasi';

/**
 * Running hourly hidden-sensor test of the live map (task F5-09), read from the file the hourly builder writes. Hourly
 * numbers, labelled as such: the EPA target applies to 24-hour means.
 */
export default function RunningValidation({ region = 'badung_denpasar', label = 'Badung–Denpasar', singleDay }: { region?: string; label?: string; singleDay?: SingleDay }) {
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
      {!f && <p className="text-gray-500 dark:text-gray-400">Memuat…</p>}
      {(f === 'failed' || (f && !s)) && <p className="text-gray-500 dark:text-gray-400">Belum ada jam yang diuji.</p>}
      {s && (
        <>
          <p>
            Setiap jam, tiap sensor warga disembunyikan bergiliran dan ditebak dari sensor lain. Dari {s.hours} jam terakhir:
            NRMSE per jam median {pct(s.median_nrmse)} (RMSE {num(s.median_rmse, 1)} µg/m³), median {num(s.sensors_median, 0)} sensor per jam;
            rentang 95% memuat {pct(s.coverage_pooled)} dari {num(s.readings, 0)} bacaan yang disembunyikan (target 90–97%).
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Angka per jam, belum dibandingkan dengan target EPA: target NRMSE ≤ 30% berlaku untuk rata-rata 24 jam.
          </p>
          {f && f !== 'failed' && (f.daily?.length ?? 0) > 0 && (() => {
            const d = f.daily![f.daily!.length - 1];
            const pool = pooledDaily(f.daily);
            return (
              <>
                <p>
                  Uji harian {d.date} (rata-rata 24 jam, sesuai target EPA): NRMSE {pct(d.nrmse)}, R² {num(d.r2)}, kemiringan {num(d.slope)},
                  titik potong {num(d.intercept, 1)} µg/m³, lolos <b>{d.passes} dari 4</b> target, dari {d.n} sensor dengan sedikitnya {d.hours_min} jam.
                </p>
                {singleDay && (
                  <p className="text-[12px] text-gray-600 dark:text-gray-400">
                    Satu hari saja menilai terutama beda antar-sensor hari itu, yang kecil (sebaran sekitar {num(singleDay.sd_within_day, 1)} µg/m³,
                    dibanding {num(singleDay.sd_pooled, 1)} µg/m³ antar-hari), jadi R² dan kemiringan satu hari rendah. Uji statis di atas, bila dinilai
                    per hari dengan cara yang sama, lolos 1 dari 4 pada {singleDay.passes_count[1]} dari {singleDay.days} hari (median R² {num(singleDay.r2)},
                    kemiringan {num(singleDay.slope)}); angka {singleDay.pooled_passed} dari 4 di tabel berasal dari gabungan {num(singleDay.pooled_n, 0)} hari-lokasi.
                  </p>
                )}
                {pool && (
                  <p>
                    Gabungan peta hidup sejak {pool.from}: {pool.n} hari-sensor dari {pool.days} hari, NRMSE {pct(pool.nrmse)}, R² {num(pool.r2)},
                    kemiringan {num(pool.slope)}, titik potong {num(pool.intercept, 1)} µg/m³, lolos <b>{pool.passes} dari 4</b>
                    {pool.days < 14 ? ' (baru sedikit hari; pembanding yang sepadan dengan tabel di atas setelah beberapa minggu)' : ''}.
                  </p>
                )}
              </>
            );
          })()}
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Sumber: v/{region}/validation_recent.json, run terakhir {s.last_run}.</p>
        </>
      )}
    </section>
  );
}
