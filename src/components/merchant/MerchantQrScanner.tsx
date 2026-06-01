import { useEffect, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X } from 'lucide-react';

// Lazy-loaded camera QR scanner (html5-qrcode lives only in this chunk). Always paired
// with a manual code-entry fallback in the dashboard, so camera failure is non-blocking.
const READER_ID = 'merchant-qr-reader';

export default function MerchantQrScanner({
  onScan, onClose,
}: {
  onScan: (text: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ID, false);
    let stopped = false;
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => { if (!stopped) { stopped = true; onScan(decodedText); } },
        undefined,
      )
      .catch((e: unknown) => {
        const name = (e as { name?: string })?.name;
        setError(name === 'NotAllowedError'
          ? 'Izin kamera ditolak — gunakan input kode.'
          : 'Kamera tidak tersedia — gunakan input kode.');
      });
    return () => {
      stopped = true;
      scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [onScan]);

  return (
    <div className="space-y-2">
      <div id={READER_ID} className="w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700" />
      {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
      <button onClick={onClose} className="w-full py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-300 inline-flex items-center justify-center gap-1.5">
        <X className="w-3.5 h-3.5" /> Tutup kamera
      </button>
    </div>
  );
}
