import type { WalkRoutingState } from './WalkRouteLayer';

/** Cards of the walking routes computed on the device: distance, time, mean NO2 and PM2.5 along each route. */
export default function WalkRouteCards({ state, mode = 'walk', onMode }: { state: WalkRoutingState | null; mode?: 'walk' | 'motor'; onMode?: (m: 'walk' | 'motor') => void }) {
  if (!state) return null;
  return (
    <div className="glass-card p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-900 dark:text-white">Rute (dihitung di perangkat)</p>
        {onMode && (
          <div className="flex gap-1" role="group" aria-label="Moda">
            {(['walk', 'motor'] as const).map((m) => (
              <button key={m} onClick={() => onMode(m)} aria-pressed={mode === m}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${mode === m ? 'bg-teal-700 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                {m === 'walk' ? 'Jalan kaki' : 'Motor'}
              </button>
            ))}
          </div>
        )}
      </div>
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
              <p className="text-[12px] text-gray-700 dark:text-gray-300">Paparan diri: NO₂ rata-rata {c.no2} · PM2,5 {c.pm25} µg/m³</p>
              {c.harga != null && (
                <p className="text-[12px] text-gray-700 dark:text-gray-300">Ditimbulkan: harga hirup rata-rata {c.harga.toLocaleString('id-ID')}× median wilayah</p>
              )}
              {c.schoolNote && (
                <p className="mt-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">{c.schoolNote}</p>
              )}
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
        {mode === 'motor'
          ? 'Motor: biaya rute menghitung paparan diri dan paparan yang ditimbulkan bagi warga sekitar (harga hirup); gang dan jalan lingkungan hanya dipakai dekat titik berangkat dan tujuan (zona napas); pada jam masuk 06.30–07.30 dan pulang 12.00–13.30 jalan kecil di depan sekolah juga dihindari. Rute darurat paling cepat dan tidak memberi poin, tetapi tetap menjauhi gang. '
          : 'Pilihan rute memakai NO₂ dari lalu lintas karena PM2,5 hampir sama di semua jalan. '}
        Angka adalah rata-rata model sepanjang rute pada jam data peta, bukan pengukuran di tempat.
      </p>
    </div>
  );
}
