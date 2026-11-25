import { lazy, Suspense } from 'react';
import { Download, Flame, Radio, Wind } from 'lucide-react';
import StatCard from '../viz/StatCard';
import LineChart from '../viz/LineChart';
import Rincian from '../viz/Rincian';
import { pm25Category } from '../../lib/ispu';
import type { FireFile } from '../../lib/nasional/firms';
import { windAt, type WindFile } from '../../lib/nasional/angin';
import type { LatarFile } from '../../lib/nasional/latar';
import type { AsapFile } from '../../lib/nasional/asap';
import { apiSini, kabKotaCsv, latarSini, TINGKAT_LABEL, type KabKota } from '../../lib/nasional/kabkota';
import { kameraKabKota, type CctvFile } from '../../lib/nasional/cctv';
import CctvRingkas from './CctvRingkas';

const PantauMap = lazy(() => import('./PantauMap'));
const ARAH = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
const n = (v: number | null | undefined, d = 0) => (v == null ? '…' : v.toLocaleString('id-ID', { maximumFractionDigits: d }));

/** N-24: one kab/kota anywhere in Indonesia: background now and 48 hours, fires inside and near, wind; CSV. */
export default function KabKotaView({ k, latar, fires, wind, hour, dark, asap = null, nama = {}, cctv = null }: {
  k: KabKota; latar: LatarFile | null; fires: FireFile | null; wind: WindFile | null; hour: number; dark: boolean;
  asap?: AsapFile | null; nama?: Record<string, string>; cctv?: CctvFile | null;
}) {
  const kamera = kameraKabKota(cctv, k.slug);
  const menuju = asap?.menuju[k.slug] ?? [];
  const jalur = menuju.map((m) => asap!.gugus.find((g) => g.id === m.gugus)?.jalur).filter((j): j is Array<[number, number]> => !!j);
  const l = latarSini(latar, k.slug);
  const api = apiSini(fires?.points ?? [], k);
  const angin = wind ? windAt(wind, k.lon, k.lat, hour) : null;
  const unduh = () => {
    const url = URL.createObjectURL(new Blob([kabKotaCsv(k, l, api.dalam)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `breeva_pantau_${k.slug}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const cat = l?.v != null ? pm25Category(l.v) : null;
  return (
    <>
      <p className="text-xs text-gray-600 dark:text-gray-300">{k.provinsi}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="PM2,5 latar" value={n(l?.v, 0)} unit="µg/m³" note={cat ? cat.name : 'memuat'} tone={l?.v != null && l.v > 55 ? 'warn' : 'neutral'} />
        <StatCard label="Tingkat" value={l ? l.t : '…'} note={l ? `${l.s} sensor dalam 25 km` : ''} icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />} />
        <StatCard label="Titik api" value={n(api.dalam.length)} note={`di dalam, 24 jam; ${n(api.dekat.length)} lagi dalam 50 km`} tone={api.dalam.length ? 'warn' : 'good'} icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />} />
        <StatCard label="Angin" value={angin ? `${n(angin.speed, 1)} m/s` : '…'} note={angin ? `dari ${ARAH[Math.round(angin.from / 45) % 8]}` : ''} icon={<Wind className="h-3.5 w-3.5" aria-hidden="true" />} />
      </div>
      {menuju.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm" data-asap-menuju>
          <p className="font-bold text-amber-900 dark:text-amber-200">Asap menuju: dalam {menuju[0].jam} jam</p>
          <p className="text-xs text-amber-900 dark:text-amber-200">
            Asap dari {menuju.length} gugus titik api bisa terbawa angin ke sini{`, paling cepat dari ${menuju[0].asal ? (nama[menuju[0].asal] ?? menuju[0].asal) : 'luar Indonesia'}`}.
            Perkiraan kasar: hanya mengikuti angin, tanpa hujan dan naik-turunnya asap.
          </p>
        </div>
      )}
      {l && <p className="text-xs text-gray-600 dark:text-gray-300" data-tingkat>Tingkat keyakinan: <b>{TINGKAT_LABEL[l.t]}</b>. Udara latar saja; asap kendaraan per ruas baru ada di Badung–Denpasar dan Kota Bogor.</p>}
      {l && (
        <div className="rounded-2xl bg-white dark:bg-gray-900 p-4">
          <LineChart title="PM2,5 latar 48 jam ke depan (µg/m³)" unit="µg/m³" min={0} series={[{ name: 'PM2,5', values: l.seri, color: '#b45309' }]}
            reference={{ value: 15, label: 'pedoman harian WHO 15' }} xLabels={['sekarang', '+48 jam']} />
        </div>
      )}
      <Suspense fallback={<div className="rounded-2xl bg-gray-200/60 dark:bg-gray-800/60 animate-pulse" style={{ height: '26rem' }} />}>
        <PantauMap fires={[...api.dalam, ...api.dekat.map((d) => d.p)]} wind={wind} hour={hour} center={[k.lat, k.lon]} zoom={kamera.length ? 12 : 9} dark={dark} jalur={jalur} cctv={kamera} />
      </Suspense>
      <CctvRingkas file={cctv} kamera={kamera} />
      <div className="flex flex-wrap gap-2">
        <button onClick={unduh} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white">
          <Download className="h-4 w-4" aria-hidden="true" />Unduh CSV (latar 48 jam, titik api)
        </button>
      </div>
      <Rincian summary="Titik api di dalam dan dekat">
        {api.dalam.length + api.dekat.length === 0 ? <p>Tidak ada titik api di dalam atau dalam 50 km selama 24 jam terakhir.</p> : (
          <ul className="space-y-1">
            {api.dalam.slice(0, 10).map((p, i) => <li key={`d${i}`}>di dalam · {p[4].replace('T', ' ').replace('Z', ' UTC')} · daya {n(p[2], 1)} MW</li>)}
            {api.dekat.slice(0, 10).map((d, i) => <li key={`k${i}`}>{n(d.km)} km · {d.p[4].replace('T', ' ').replace('Z', ' UTC')} · daya {n(d.p[2], 1)} MW</li>)}
          </ul>
        )}
      </Rincian>
    </>
  );
}
