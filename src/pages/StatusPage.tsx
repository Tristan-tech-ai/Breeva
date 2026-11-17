import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Seo } from '../components/Seo';
import { FIELD_REGIONS, fieldBase } from '../lib/field/source';
import { runsSummary, runsText, type RunsFile } from '../lib/field/runsRecent';
import { FRESH_MINUTES, manifestStatus, statusText, type FieldStatus } from '../lib/field/status';
import { readSaved, saveRegionOffline, sizeLabel } from '../lib/pwa/offlineRegion';

type Saving = { state: 'saving'; done: number; total: number } | { state: 'done'; bytes: number; files: number; run: string; at: string } | { state: 'error'; error: string };

/** Public status of the hourly field: run, age and data source of each region, read from the same manifests the map reads. */
export default function StatusPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Record<string, FieldStatus | null>>({});
  // the builder's last day per region (F2-23): hours published, failed or missing
  const [runs, setRuns] = useState<Record<string, RunsFile | null>>({});
  // saving a region for the offline demo (F2-15): pressed by the user, never automatic
  const [saving, setSaving] = useState<Record<string, Saving>>({});
  const save = (r: (typeof FIELD_REGIONS)[number]) => {
    setSaving((p) => ({ ...p, [r.name]: { state: 'saving', done: 0, total: 0 } }));
    saveRegionOffline(fieldBase(), { name: r.name, geometry: r.geometry }, {
      onProgress: (done, total) => setSaving((p) => ({ ...p, [r.name]: { state: 'saving', done, total } })),
    })
      .then((res) => setSaving((p) => ({ ...p, [r.name]: { state: 'done', ...res, at: new Date().toISOString() } })))
      .catch((e: Error) => setSaving((p) => ({ ...p, [r.name]: { state: 'error', error: e.message } })));
  };

  // what is already saved for offline, read from the caches (F2-16), so the presenter can check before switching Wi-Fi off
  useEffect(() => {
    let alive = true;
    for (const r of FIELD_REGIONS) {
      readSaved(fieldBase(), { name: r.name, geometry: r.geometry })
        .then((info) => { if (alive && info) setSaving((p) => (p[r.name] ? p : { ...p, [r.name]: { state: 'done', ...info } })); });
    }
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      for (const r of FIELD_REGIONS) {
        fetch(`${fieldBase()}/v/${r.name}/manifest.json`, { cache: 'no-cache' })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((m) => alive && setRows((p) => ({ ...p, [r.name]: manifestStatus(m, new Date()) })))
          .catch((e: Error) => alive && setRows((p) => ({ ...p, [r.name]: { ok: false, error: e.message } })));
        fetch(`${fieldBase()}/v/${r.name}/runs_recent.json`, { cache: 'no-cache' })
          .then((res) => (res.ok ? res.json() : null))
          .then((f: RunsFile | null) => alive && setRuns((p) => ({ ...p, [r.name]: f })))
          .catch(() => alive && setRuns((p) => ({ ...p, [r.name]: null })));
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
        <p className="text-[13px] text-gray-600 dark:text-gray-400">
          Untuk peragaan tanpa internet: tekan "Simpan … untuk tanpa internet" sekali sambil online (sekitar 3,5 MB untuk Kota Bogor, 7 MB untuk Badung–Denpasar).
          Angkanya tetap jam yang tersimpan.
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
                {(() => {
                  const rs = runsSummary(runs[r.name] ?? null);
                  if (!rs) return null;
                  const fmt = (d: Date) => d.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                  return <p className={`mt-1 text-[12px] ${rs.ok === rs.hours ? 'text-gray-600 dark:text-gray-400' : 'text-amber-800 dark:text-amber-300'}`}>{runsText(rs, fmt)}</p>;
                })()}
                {(() => {
                  const sv = saving[r.name];
                  if (sv?.state === 'saving') return <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-300" aria-live="polite">Menyimpan… {sv.total ? `${sv.done} dari ${sv.total} berkas` : ''}</p>;
                  if (sv?.state === 'done') return (
                    <div className="mt-2" aria-live="polite">
                      <p className="text-[12px] text-teal-800 dark:text-teal-300">
                        Tersimpan untuk tanpa internet: {sizeLabel(sv.bytes)} ({sv.files} berkas, run {sv.run}, disimpan {new Date(sv.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}). Peta dan rute {r.label} jalan tanpa internet dengan angka jam itu; peta dasar tidak ikut tersimpan.
                      </p>
                      <button onClick={() => save(r)} className="mt-1 min-h-8 rounded-full px-2 text-[12px] font-semibold text-teal-800 dark:text-teal-200 underline underline-offset-2">Simpan ulang (angka jam terbaru)</button>
                    </div>
                  );
                  return (
                    <>
                      <button onClick={() => save(r)} className="mt-2 min-h-8 rounded-full border border-teal-700 px-3 py-1 text-[12px] font-semibold text-teal-800 dark:text-teal-200">
                        Simpan {r.label} untuk tanpa internet
                      </button>
                      {sv?.state === 'error' && <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">Gagal menyimpan: {sv.error}</p>}
                    </>
                  );
                })()}
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
