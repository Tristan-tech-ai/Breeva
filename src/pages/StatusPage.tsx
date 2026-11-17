import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Seo } from '../components/Seo';
import { FIELD_REGIONS, fieldBase } from '../lib/field/source';
import { FRESH_MINUTES, manifestStatus, statusText, type FieldStatus } from '../lib/field/status';

/** Public status of the hourly field: run, age and data source of each region, read from the same manifests the map reads. */
export default function StatusPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Record<string, FieldStatus | null>>({});

  useEffect(() => {
    let alive = true;
    const load = () => {
      for (const r of FIELD_REGIONS) {
        fetch(`${fieldBase()}/v/${r.name}/manifest.json`, { cache: 'no-cache' })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((m) => alive && setRows((p) => ({ ...p, [r.name]: manifestStatus(m, new Date()) })))
          .catch((e: Error) => alive && setRows((p) => ({ ...p, [r.name]: { ok: false, error: e.message } })));
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 pb-16">
      <Seo title="Status data — Breeva" description="Kapan peta polusi udara Breeva terakhir dihitung, per wilayah." path="/status" />
      <header className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Kembali" className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold">Status data</h1>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 pt-5 space-y-4">
        <p className="text-sm leading-relaxed">
          Peta dihitung ulang setiap jam di cloud (menit ke-20) tanpa komputer rumah. Data disebut segar bila dihitung kurang
          dari {FRESH_MINUTES} menit lalu.
        </p>
        <ul className="space-y-2">
          {FIELD_REGIONS.map((r) => {
            const s = rows[r.name];
            return (
              <li key={r.name} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                <div className="flex items-center gap-2">
                  <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${!s ? 'bg-gray-300' : s.ok ? 'bg-teal-600' : 'bg-amber-500'}`} />
                  <span className="text-sm font-semibold">{r.label}</span>
                  {s?.run && <span className="ml-auto text-[11px] tabular-nums text-gray-500">run {s.run}</span>}
                </div>
                <p className="mt-1 text-[13px] text-gray-700 dark:text-gray-300">{s ? statusText(s) : 'Memuat…'}</p>
                {s?.computed_at && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {new Date(s.computed_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Sumber: sensor warga OpenAQ (Badung–Denpasar), jarak pandang bandara, latar CAMS lewat Open-Meteo, dan asap kendaraan
          dari semua jalan dalam 500 m dengan rumus sebaran dari panduan EPA (CALINE-3, ISC3, AERMOD). Kota Bogor belum punya
          titik ukur, jadi nilainya indikatif.
        </p>
      </main>
    </div>
  );
}
