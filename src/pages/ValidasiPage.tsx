import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Seo } from '../components/Seo';
import { epaFlags, num, pct, verdict, type Validasi } from '../lib/validasi';
import ExhaustExplainer from '../components/features/ExhaustExplainer';
import RunningValidation from '../components/features/RunningValidation';

const DATA_URL = '/data/validasi.json';

export default function ValidasiPage() {
  const navigate = useNavigate();
  const [v, setV] = useState<Validasi | null>(null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Validasi) => setV(d))
      .catch(() => setGagal(true));
  }, []);

  const cell = (ok: boolean, text: string) => (
    <td className={`px-3 py-2 tabular-nums ${ok ? 'text-teal-700 dark:text-teal-300' : 'text-amber-700 dark:text-amber-400'}`}>
      {text} <span className="text-[11px]">{ok ? '(lolos)' : '(belum)'}</span>
    </td>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 pb-16">
      <Seo title="Validasi akurasi — Breeva" description="Bagaimana Breeva menguji akurasi peta polusi udara per ruas: uji di lokasi yang disembunyikan dengan target EPA." path="/validasi" />
      <header className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Kembali" className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold">Validasi akurasi</h1>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 pt-5 space-y-6">
        {gagal && <p className="text-sm text-amber-700">Data validasi tidak dapat dimuat.</p>}
        {!v && !gagal && <p className="text-sm text-gray-500">Memuat…</p>}
        {v && (
          <>
            <section className="space-y-2">
              <p className="text-sm leading-relaxed">{v.rule}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Standar: {v.standard.name}. Target: NRMSE ≤ {v.standard.nrmse_pct}%, R² ≥ {num(v.standard.r2)}, kemiringan {num(v.standard.slope[0])}–{num(v.standard.slope[1])}, titik potong ±{v.standard.intercept} µg/m³.
              </p>
            </section>

            <section>
              <h2 className="text-sm font-semibold mb-2">Rata-rata harian PM2,5</h2>
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-gray-900 text-left text-xs">
                    <tr><th className="px-3 py-2">Uji</th><th className="px-3 py-2">NRMSE</th><th className="px-3 py-2">R²</th><th className="px-3 py-2">Kemiringan</th><th className="px-3 py-2">Titik potong</th><th className="px-3 py-2">Hasil</th></tr>
                  </thead>
                  <tbody>
                    {v.daily.map((r) => {
                      const { flags, passed } = epaFlags(r, v.standard);
                      return (
                        <tr key={r.id} className="border-t border-gray-200 dark:border-gray-800">
                          <td className="px-3 py-2">{r.label}{r.n ? <span className="block text-[11px] text-gray-500">n = {r.n.toLocaleString('id-ID')} hari-lokasi · {r.source}</span> : <span className="block text-[11px] text-gray-500">{r.source}</span>}</td>
                          {cell(flags.nrmse, `${num(r.nrmse_pct, 1)}%`)}
                          {cell(flags.r2, num(r.r2))}
                          {cell(flags.slope, num(r.slope))}
                          {cell(flags.intercept, num(r.intercept, 1))}
                          <td className="px-3 py-2 text-xs font-semibold">{verdict(passed)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <RunningValidation />

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm space-y-1">
                <h2 className="font-semibold">Per jam (Bali)</h2>
                <p>NRMSE {num(v.hourly.nrmse_pct, 1)}% (RMSE {num(v.hourly.rmse, 1)} µg/m³): per jam belum akurat.</p>
                <p>Rentang 95% memuat {pct(v.hourly.pi95_coverage_calibrated)} nilai yang disembunyikan setelah kalibrasi (sebelumnya {pct(v.hourly.pi95_coverage_before)}); lebar median {num(v.hourly.pi95_median_width, 1)} µg/m³.</p>
                <p className="text-[11px] text-gray-500">{v.hourly.source}</p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm space-y-1">
                <h2 className="font-semibold">Kota tanpa stasiun</h2>
                <p>Galat per jam: model global {num(v.city_hourly_rmse.global_model, 1)} → dengan kalibrasi dan jarak pandang bandara {num(v.city_hourly_rmse.calibrated_with_visibility, 1)} µg/m³.</p>
                <p>Pada bulan yang tidak dilatih (Sep–Okt) angkanya tetap: {num(v.time_split_calibration.time_and_loco, 1)} lawan {num(v.time_split_calibration.loco_sep_oct, 1)}; tanpa musim asap Palembang {num(v.time_split_calibration.without_palembang, 1)} (model global {num(v.time_split_calibration.cams_without_palembang, 1)}).</p>
                <p className="text-[11px] text-gray-500">{v.city_hourly_rmse.source} · {v.time_split_calibration.source}</p>
              </div>
            </section>

            <ExhaustExplainer />

            <section>
              <h2 className="text-sm font-semibold mb-2">Sumber data yang kami tolak</h2>
              <ul className="space-y-2 text-sm">
                {v.rejected.map((r) => (
                  <li key={r.name} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
                    <span className="font-semibold">{r.name}</span>
                    {r.before != null && r.after != null ? <> : {num(r.before)} → {num(r.after)} ({r.unit})</> : <> : {r.unit}</>}
                    <span className="block text-[11px] text-gray-500">{r.source}</span>
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-[11px] text-gray-500">Dibangun {new Date(v.built_at).toLocaleString('id-ID')} dari berkas validasi; kode dan skrip uji ada di repositori Breeva.</p>
          </>
        )}
      </main>
    </div>
  );
}
