import { useState } from 'react';
import { Clock, School, Users, Wind } from 'lucide-react';
import type { WalkRoutingState } from './WalkRouteLayer';
import { routeLink } from '../../lib/route/share';
import { DEPART_CHOICES } from '../../lib/route/depart';
import FieldAgeNote from './FieldAgeNote';
import { announceRoutes } from '../../lib/route/summary';
import { doseChip, doseRatios, schoolChip, soonChip, timeChip } from '../../lib/route/visual';
import Rincian from '../viz/Rincian';

const TONE = {
  good: 'bg-emerald-600 text-white',
  bad: 'bg-rose-600 text-white',
  same: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
  base: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200',
  none: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
} as const;

function Chip({ icon, children, warn }: { icon?: React.ReactNode; children: React.ReactNode; warn?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${warn ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>
      {icon}{children}
    </span>
  );
}

/**
 * Cards of the routes computed on the device (N-03): per route one big chip (exhaust breathed against the fastest
 * route), minutes and distance, a bar of the exhaust dose, and chips for the school zone, harga hirup and a better
 * departure hour. Every sentence of the old card stays under "Rincian".
 */
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
  const ratios = doseRatios(state.cards);
  const top = Math.max(1, ...ratios.filter((r): r is number => r != null));
  return (
    <div className="glass-card p-4">
      {/* one short summary for screen readers, instead of re-reading the whole card on every change (F1-47) */}
      <p className="sr-only" role="status">{announceRoutes(state.cards, state.status)}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-900 dark:text-white">Rute</p>
        {onMode && (
          <div className="flex gap-1" role="group" aria-label="Moda">
            {(['walk', 'motor'] as const).map((m) => (
              <button key={m} onClick={() => onMode(m)} aria-pressed={mode === m}
                className={`min-h-8 rounded-full px-3 py-1 text-[11px] font-bold ${mode === m ? 'bg-teal-700 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
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
      {(state.cards.length === 0 || ends) && (
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          {state.cards.length === 0 && state.status}
          {ends && state.cards.length > 0 && (
            <button onClick={copy} className="inline-flex min-h-8 items-center font-semibold text-teal-700 dark:text-teal-300 underline underline-offset-2">
              {copied ? 'Tautan disalin' : 'Salin tautan rute'}
            </button>
          )}
        </p>
      )}
      {state.cards.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {state.cards.map((c, k) => {
            const chip = doseChip(c, k);
            const ratio = ratios[k];
            const t = timeChip(c), sz = schoolChip(c), soon = soonChip(c);
            return (
              <div key={c.index} className="rounded-xl border border-gray-200 dark:border-gray-700/50 p-3" data-route-card={k}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="truncate text-xs font-bold text-gray-900 dark:text-white">{c.label}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums ${TONE[chip.tone]}`} data-dose-chip>{chip.text}</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold tabular-nums leading-none text-gray-900 dark:text-white">{c.minutes}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">menit · {c.km} km</span>
                  {t && <Chip icon={<Clock className="h-3 w-3" aria-hidden="true" />}>{t}</Chip>}
                </div>
                {ratio != null && (
                  <div className="mt-2" aria-hidden="true">
                    <div className="flex items-center gap-2">
                      <Wind className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="relative h-2.5 flex-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <span className="absolute inset-y-0 left-0 rounded-full" data-dose-bar={(ratio / top).toFixed(2)}
                          style={{ width: `${Math.max(3, (ratio / top) * 100)}%`, background: k === 0 ? '#c2410c' : c.color }} />
                        {k > 0 && ratios[0] != null && (
                          <span className="absolute inset-y-0 border-r-2 border-orange-700/70" style={{ left: `${(1 / top) * 100}%` }} />
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-5 text-[10px] text-gray-500 dark:text-gray-400">asap kendaraan dihirup{k > 0 && ratios[0] != null ? ' · garis = rute tercepat' : ''}</p>
                  </div>
                )}
                {(sz || c.harga != null || soon) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sz && <Chip warn icon={<School className="h-3 w-3" aria-hidden="true" />}>{sz}</Chip>}
                    {c.harga != null && <Chip icon={<Users className="h-3 w-3" aria-hidden="true" />}>harga hirup {c.harga.toLocaleString('id-ID')}×</Chip>}
                    {soon && <Chip icon={<Clock className="h-3 w-3" aria-hidden="true" />}>{soon}</Chip>}
                  </div>
                )}
                <Rincian summary="Rincian rute" className="mt-2">
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{c.headline}</p>
                  {c.exh != null && <p>Asap kendaraan rata-rata {c.exh.toLocaleString('id-ID')} µg/m³ (NOx lalu lintas)</p>}
                  {c.forecastNote && <p>{c.forecastNote}</p>}
                  {c.soonHint && <p>{c.soonHint}</p>}
                  {c.harga != null && <p>Ditimbulkan: harga hirup rata-rata {c.harga.toLocaleString('id-ID')}× median wilayah</p>}
                  {c.schoolNote && <p>{c.schoolNote}</p>}
                  {c.schoolCost && <p>{c.schoolCost}</p>}
                  {c.sameNote && <p>{c.sameNote}</p>}
                </Rincian>
              </div>
            );
          })}
        </div>
      )}
      {state.cards.length > 0 && (
        <Rincian summary="Cara menghitung" className="mt-2">
          <p>
            {mode === 'motor'
              ? 'Motor: biaya rute menghitung paparan diri dan paparan yang ditimbulkan bagi warga sekitar (harga hirup); gang dan jalan lingkungan hanya dipakai dekat titik berangkat dan tujuan (zona napas); pada jam masuk 06.30–07.30 dan pulang 12.00–13.30 jalan kecil di depan sekolah juga dihindari. Rute darurat paling cepat dan tidak memberi poin, tetapi tetap menjauhi gang.'
              : 'Asap kendaraan (gas buang dan jelaga knalpot) paling pekat di jalan ramai dan cepat menipis begitu menjauh, jadi rute dipilih menurut asap kendaraan yang dihirup.'}
          </p>
          <p>Udara latar kota (PM2,5 sekitar {Math.round(state.cards[0].pm25)} µg/m³, dari pembakaran dan asap jauh) sama di semua rute dan tidak bisa dihindari lewat pilihan jalan.</p>
          <p>Angka adalah perkiraan model per ruas pada jam data peta, bukan pengukuran di tempat. {state.status}</p>
        </Rincian>
      )}
      {ends && <FieldAgeNote at={ends.from} className="mt-1" />}
    </div>
  );
}
