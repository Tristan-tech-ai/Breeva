import type { WalkRoutingState } from './WalkRouteLayer';

/** Cards of the walking routes computed on the device: distance, time, mean NO2 and PM2.5 along each route. */
export default function WalkRouteCards({ state }: { state: WalkRoutingState | null }) {
  if (!state) return null;
  return (
    <div className="glass-card p-4" aria-live="polite">
      <p className="text-xs font-semibold text-gray-900 dark:text-white">Rute jalan kaki (dihitung di perangkat)</p>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{state.status}</p>
      {state.cards.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {state.cards.map((c) => (
            <div key={c.index} className="rounded-xl border border-gray-200 dark:border-gray-700/50 p-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-6 rounded-full" style={{ background: c.color }} />
                <span className="text-xs font-bold text-gray-900 dark:text-white">{c.label}</span>
              </div>
              <p className="mt-1.5 text-[12px] text-gray-700 dark:text-gray-300">{c.km} km · {c.minutes} menit</p>
              <p className="text-[12px] text-gray-700 dark:text-gray-300">NO₂ rata-rata {c.no2} · PM2,5 {c.pm25} µg/m³</p>
              {c.vsFastest && (
                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {c.vsFastest.extraTimePct >= 0 ? '+' : ''}{c.vsFastest.extraTimePct}% waktu · NO₂ {c.vsFastest.no2Pct >= 0 ? '+' : ''}{c.vsFastest.no2Pct}% dibanding tercepat
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10.5px] leading-relaxed text-gray-400 dark:text-gray-500">
        Pilihan rute memakai NO₂ dari lalu lintas karena PM2,5 hampir sama di semua jalan. Angka adalah rata-rata konsentrasi
        model sepanjang rute pada jam data peta, bukan pengukuran di tempat.
      </p>
    </div>
  );
}
