/** N-05: the four EPA daily targets of one test as bars: a green zone is the target, the dot is the result. */
export interface EpaValues { nrmse_pct: number | null; r2: number | null; slope: number | null; intercept: number | null }

const fmt = (v: number, d = 2) => v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });

interface Row { label: string; value: number | null; text: string; lo: number; hi: number; zone: [number, number]; ok: boolean }

function epaRows(v: EpaValues): Row[] {
  const t = (x: number | null, d: number, unit = '') => (x == null ? '—' : `${fmt(x, d)}${unit}`);
  const n = v.nrmse_pct, r2 = v.r2, sl = v.slope, ic = v.intercept;
  return [
    { label: 'NRMSE', value: n, text: t(n, 1, '%'), lo: 0, hi: Math.max(60, n ?? 0), zone: [0, 30], ok: n != null && n <= 30 },
    { label: 'R²', value: r2, text: t(r2, 2), lo: 0, hi: 1, zone: [0.7, 1], ok: r2 != null && r2 >= 0.7 },
    { label: 'Kemiringan', value: sl, text: t(sl, 2), lo: 0, hi: Math.max(2, sl ?? 0), zone: [0.65, 1.35], ok: sl != null && Math.abs(sl - 1) <= 0.35 },
    { label: 'Titik potong', value: ic, text: t(ic, 1, ' µg/m³'), lo: Math.min(-20, ic ?? 0), hi: Math.max(20, ic ?? 0), zone: [-5, 5], ok: ic != null && Math.abs(ic) <= 5 },
  ];
}

export default function EpaBars({ title, note, values }: { title: string; note?: string; values: EpaValues }) {
  const rows = epaRows(values);
  const passed = rows.filter((r) => r.ok).length;
  return (
    <figure className="m-0 rounded-xl border border-gray-200 dark:border-gray-800 p-3" data-viz="epa-bars">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${passed === 4 ? 'bg-teal-700 text-white' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'}`}>lolos {passed} dari 4</span>
      </figcaption>
      {note && <p className="text-[11px] text-gray-500 dark:text-gray-400">{note}</p>}
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => {
          const pos = (x: number) => `${((Math.min(r.hi, Math.max(r.lo, x)) - r.lo) / (r.hi - r.lo)) * 100}%`;
          return (
            <div key={r.label} className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-2 text-xs">
              <span className="text-gray-600 dark:text-gray-300">{r.label}</span>
              <span className="relative h-2.5 rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
                <span className="absolute inset-y-0 rounded-full bg-teal-200 dark:bg-teal-900" style={{ left: pos(r.zone[0]), width: `calc(${pos(r.zone[1])} - ${pos(r.zone[0])})` }} />
                {r.value != null && <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-gray-900 ${r.ok ? 'bg-teal-700' : 'bg-amber-600'}`} style={{ left: pos(r.value) }} />}
              </span>
              <span className={`tabular-nums font-semibold ${r.ok ? 'text-teal-700 dark:text-teal-300' : 'text-amber-700 dark:text-amber-400'}`}>{r.text}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
