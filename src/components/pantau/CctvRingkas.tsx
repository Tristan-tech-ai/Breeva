import { Car } from 'lucide-react';
import { CCTV_LABEL, cctvBasi, ringkasCctv, type CctvFile, type CctvKamera } from '../../lib/nasional/cctv';

const jamWib = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB';

/** N-35: the traffic-camera summary under a /pantau map (cameras shown, what was counted, the trial label). */
export default function CctvRingkas({ file, kamera }: { file: CctvFile | null; kamera: CctvKamera[] }) {
  if (!file || kamera.length === 0) return null;
  const kota = ringkasCctv(kamera);
  const basi = cctvBasi(file);
  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-900 bg-teal-50/60 dark:bg-teal-950/30 p-3 text-xs text-gray-700 dark:text-gray-200" data-cctv>
      <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
        <Car className="h-4 w-4" aria-hidden="true" />Kamera lalu lintas: {kamera.length.toLocaleString('id-ID')} titik
        <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-200">{CCTV_LABEL}</span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {kota.map((r) => (
          <li key={r.kota}>{r.nama}: {r.ok.toLocaleString('id-ID')} dari {r.kamera.toLocaleString('id-ID')} kamera terbaca, {r.kendaraan.toLocaleString('id-ID')} kendaraan terlihat{r.padat ? `, ${r.padat} lebih padat dari jam yang sama kemarin` : ''}</li>
        ))}
      </ul>
      <p className="mt-1">
        Satu gambar per kamera tiap 20 menit dihitung di server lalu dibuang; tidak ada gambar yang disimpan atau ditampilkan. Warna titik: hijau sepi, kuning biasa, merah padat
        dibanding jam yang sama pada hari sebelumnya di kamera itu (hijau kebiruan: belum ada data jam yang sama kemarin; abu-abu: kamera mati atau buram).
        Belum masuk angka peta.
      </p>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Diperbarui {jamWib(file.updated_at)}{basi ? ' (tertunda)' : ''}. Dimatikan 6 Des 2026.</p>
    </div>
  );
}
