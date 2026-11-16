import { useState } from 'react';
import type { WalkRoutingState } from './WalkRouteLayer';
import { routeLink } from '../../lib/route/share';
import { DEPART_CHOICES } from '../../lib/route/depart';
import FieldAgeNote from './FieldAgeNote';

/** Cards of the routes computed on the device: vehicle exhaust breathed against the fastest route, time, distance. */
export default function WalkRouteCards({ state, mode = 'walk', onMode, depart = null, onDepart }: {
  state: WalkRoutingState | null; mode?: 'walk' | 'motor'; onMode?: (m: 'walk' | 'motor') => void;
  depart?: string | null; onDepart?: (d: string | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const ends = state.ends;
  const copy = () => {
    if (!ends) return;
    const url = routeLink(`${window.location.origin}${window.location.pathname}`, { ...ends, mode }, depart);
    navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
  };
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
      {onDepart && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
          Berangkat
          <select value={depart ?? ''} onChange={(e) => onDepart(e.target.value || null)} aria-label="Jam berangkat"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-[11px]">
            {DEPART_CHOICES.map((c) => <option key={c.label} value={c.value ?? ''}>{c.label}</option>)}
            {depart && !DEPART_CHOICES.some((c) => c.value === depart) && <option value={depart}>{depart.replace(':', '.')} (dari tautan)</option>}
          </select>
        </label>
      )}
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        {state.status}
        {ends && state.cards.length > 0 && (
          <button onClick={copy} className="ml-2 font-semibold text-teal-700 dark:text-teal-300 underline underline-offset-2">
            {copied ? 'Tautan disalin' : 'Salin tautan rute'}
          </button>
        )}
      </p>
      {state.cards.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {state.cards.map((c) => (
            <div key={c.index} className="rounded-xl border border-gray-200 dark:border-gray-700/50 p-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-6 rounded-full" style={{ background: c.color }} />
                <span className="text-xs font-bold text-gray-900 dark:text-white">{c.label}</span>
              </div>
              <p className="mt-1.5 text-[13px] font-semibold leading-snug text-gray-900 dark:text-white">{c.headline}</p>
              <p className="mt-0.5 text-[12px] text-gray-700 dark:text-gray-300">
                {c.km} km · {c.minutes} menit
                {c.vsFastest && c.vsFastest.extraMin !== 0 && ` (${c.vsFastest.extraMin > 0 ? '+' : ''}${c.vsFastest.extraMin} menit)`}
              </p>
              {c.exh != null && c.vsFastest && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">Asap kendaraan rata-rata {c.exh.toLocaleString('id-ID')} µg/m³ (NOx lalu lintas)</p>
              )}
              {c.forecastNote && <p className="text-[11px] text-sky-700 dark:text-sky-300">{c.forecastNote}</p>}
              {c.soonHint && <p className="mt-0.5 text-[11.5px] font-medium text-teal-700 dark:text-teal-300">{c.soonHint}</p>}
              {c.harga != null && (
                <p className="text-[12px] text-gray-700 dark:text-gray-300">Ditimbulkan: harga hirup rata-rata {c.harga.toLocaleString('id-ID')}× median wilayah</p>
              )}
              {c.schoolNote && (
                <p className="mt-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">{c.schoolNote}</p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10.5px] leading-relaxed text-gray-400 dark:text-gray-500">
        {mode === 'motor'
          ? 'Motor: biaya rute menghitung paparan diri dan paparan yang ditimbulkan bagi warga sekitar (harga hirup); gang dan jalan lingkungan hanya dipakai dekat titik berangkat dan tujuan (zona napas); pada jam masuk 06.30–07.30 dan pulang 12.00–13.30 jalan kecil di depan sekolah juga dihindari. Rute darurat paling cepat dan tidak memberi poin, tetapi tetap menjauhi gang. '
          : 'Asap kendaraan (gas buang dan jelaga knalpot) paling pekat di jalan ramai dan cepat menipis begitu menjauh, jadi rute dipilih menurut asap kendaraan yang dihirup. '}
        {state.cards.length > 0 && `Udara latar kota (PM2,5 sekitar ${Math.round(state.cards[0].pm25)} µg/m³, dari pembakaran dan asap jauh) sama di semua rute dan tidak bisa dihindari lewat pilihan jalan. `}
        Angka adalah perkiraan model per ruas pada jam data peta, bukan pengukuran di tempat.
      </p>
      {ends && <FieldAgeNote at={ends.from} className="mt-1" />}
    </div>
  );
}
