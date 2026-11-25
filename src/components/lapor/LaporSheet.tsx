import { useState } from 'react';
import { Check, Copy, ExternalLink, MapPin, X } from 'lucide-react';
import { JENIS_LAPOR, LAPOR_GO_ID, kirimLaporan, teksLapor, type JenisLapor, type LaporHasil } from '../../lib/lapor';

const ALASAN: Record<string, string> = {
  batas: 'Batas 5 laporan per hari dari ponsel ini sudah tercapai. Coba lagi besok.',
  lokasi: 'Lokasi di luar Indonesia.',
  jaringan: 'Tidak tersambung. Coba lagi saat ada sinyal.',
  konfigurasi: 'Laporan belum bisa dikirim dari versi ini.',
  jenis: 'Pilih jenis asap dulu.',
  perangkat: 'Coba muat ulang halaman.',
};

/** N-12: the report form. Kind first (big buttons), place from GPS or the map centre, an optional note; after sending,
 * the user may forward the same text to LAPOR! themselves. */
export default function LaporSheet({ center, onClose }: { center: { lat: number; lng: number } | null; onClose: () => void }) {
  const [jenis, setJenis] = useState<JenisLapor | null>(null);
  const [pos, setPos] = useState(center);
  const [sumber, setSumber] = useState<'peta' | 'gps'>('peta');
  const [catatan, setCatatan] = useState('');
  const [kirim, setKirim] = useState(false);
  const [hasil, setHasil] = useState<LaporHasil | null>(null);
  const [salin, setSalin] = useState(false);

  const gps = () => navigator.geolocation?.getCurrentPosition((p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setSumber('gps'); }, () => {}, { enableHighAccuracy: false, timeout: 10000 });
  const go = async () => {
    if (!jenis || !pos) return;
    setKirim(true);
    setHasil(await kirimLaporan({ jenis, lat: pos.lat, lng: pos.lng, catatan }));
    setKirim(false);
  };
  const teks = jenis && pos ? teksLapor({ jenis, lat: pos.lat, lng: pos.lng, catatan }) : '';

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="lapor-judul" className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-gray-900 p-5 shadow-xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="lapor-judul" className="text-lg font-extrabold text-gray-900 dark:text-white">Laporkan asap</h2>
          <button onClick={onClose} aria-label="Tutup" className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {hasil?.ok ? (
          <div className="mt-4 space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" aria-hidden="true" />Terkirim. Terima kasih. Sisa hari ini: {hasil.sisa}.</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">Laporanmu masuk ke hitungan per wilayah di Breeva. Ingin pemerintah menindaklanjuti? Teruskan sendiri ke LAPOR!, kanal pengaduan resmi.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { void navigator.clipboard?.writeText(teks).then(() => setSalin(true), () => {}); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 px-4 text-sm font-semibold">
                <Copy className="h-4 w-4" aria-hidden="true" />{salin ? 'Teks tersalin' : 'Salin teks laporan'}
              </button>
              <a href={LAPOR_GO_ID} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white">
                Buka LAPOR! <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-gray-700 dark:text-gray-200">Apa yang kamu lihat?</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {JENIS_LAPOR.map((j) => (
                  <button key={j.id} type="button" aria-pressed={jenis === j.id} onClick={() => setJenis(j.id)}
                    className={`min-h-11 rounded-2xl px-3 text-left text-sm font-semibold ring-1 ${jenis === j.id ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 ring-gray-200 dark:ring-gray-700'}`}>
                    {j.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{pos ? (sumber === 'gps' ? 'Lokasiku' : 'Tengah peta') : 'Lokasi belum ada'}</span>
              <button type="button" onClick={gps} className="min-h-9 rounded-full bg-gray-100 dark:bg-gray-800 px-3 font-semibold">Pakai lokasiku</button>
            </div>
            <label className="mt-3 block text-xs font-semibold text-gray-700 dark:text-gray-200">
              Keterangan (boleh kosong)
              <textarea value={catatan} onChange={(e) => setCatatan(e.target.value.slice(0, 280))} rows={2} maxLength={280}
                className="mt-1 w-full rounded-xl bg-gray-50 dark:bg-gray-800 p-2 text-sm font-normal ring-1 ring-gray-200 dark:ring-gray-700" />
            </label>
            {hasil && !hasil.ok && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{ALASAN[hasil.alasan] ?? 'Gagal mengirim.'}</p>}
            <button onClick={go} disabled={!jenis || !pos || kirim} className="mt-4 w-full min-h-11 rounded-2xl bg-emerald-700 text-white font-bold disabled:opacity-50">
              {kirim ? 'Mengirim…' : 'Kirim laporan'}
            </button>
            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Lokasi dibulatkan sekitar 100 m. Namamu tidak pernah ditampilkan; yang tampil hanya jumlah laporan per wilayah. Paling banyak 5 laporan per hari.</p>
          </>
        )}
      </div>
    </div>
  );
}
