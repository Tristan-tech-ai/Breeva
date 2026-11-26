import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { KARTU_BUKA, KARTU_TUTUP, saranJam, tutupKartu, type KartuDetail } from '../../lib/field/kartu';

type Seri = { id: string; saran: string; svg: string } | { id: string; muat: true } | null;

/**
 * Card of a tapped road at the bottom edge of the map (M-U01). Closed: road name, the number of the active mode with
 * its category, one hour advice (three lines, about 90 px). Closes with the X button (44 px), a tap on the map, a
 * swipe down, or Esc. The map never moves to show it.
 */
export default function KartuRuas({ wadah }: { wadah?: HTMLElement | null }) {
  const [d, setD] = useState<KartuDetail | null>(null);
  const [rinci, setRinci] = useState(false);
  const [seri, setSeri] = useState<Seri>(null);
  const idRef = useRef<string | null>(null);
  const geser = useRef<number | null>(null);

  useEffect(() => {
    const buka = (e: Event) => {
      const det = (e as CustomEvent<KartuDetail>).detail;
      const sama = idRef.current === det.id;
      idRef.current = det.id;
      setD(det);
      if (sama) return; // the map mode changed: same road, keep the hours and the details
      setRinci(false);
      if (!det.seri) { setSeri(null); return; }
      setSeri({ id: det.id, muat: true });
      det.seri()
        .then(({ pts, svg }) => { if (idRef.current === det.id) setSeri({ id: det.id, saran: saranJam(pts), svg }); })
        .catch(() => { if (idRef.current === det.id) setSeri(null); });
    };
    const tutup = () => { idRef.current = null; setD(null); setSeri(null); setRinci(false); };
    window.addEventListener(KARTU_BUKA, buka);
    window.addEventListener(KARTU_TUTUP, tutup);
    return () => { window.removeEventListener(KARTU_BUKA, buka); window.removeEventListener(KARTU_TUTUP, tutup); tutupKartu(); };
  }, []);

  useEffect(() => {
    if (!d) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') tutupKartu(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [d]);

  if (!d) return null;
  const k = d.kartu;
  const saran = seri && 'muat' in seri ? 'Memuat jam paling sedikit asap…' : seri?.saran || '';

  const isi = (
    <div
      role="region"
      aria-label={`Ruas terpilih: ${k.judul}`}
      data-kartu-ruas
      style={{ bottom: 'calc(var(--sheet-h, 0px) + 0.5rem)' }}
      className="absolute inset-x-2 z-[1150] rounded-2xl bg-white text-gray-900 shadow-xl ring-1 ring-black/10 dark:bg-gray-900 dark:text-gray-100 dark:ring-white/10"
      onPointerDown={(e) => { geser.current = e.clientY; }}
      onPointerUp={(e) => { if (geser.current != null && e.clientY - geser.current > 40) tutupKartu(); geser.current = null; }}
      onPointerCancel={() => { geser.current = null; }}
      // /home: the page's own gestures can cancel the pointer events, so a touch swipe is read from touch events too
      onTouchStart={(e) => { geser.current = e.touches[0]?.clientY ?? null; }}
      onTouchEnd={(e) => { const y = e.changedTouches[0]?.clientY; if (geser.current != null && y != null && y - geser.current > 40) tutupKartu(); geser.current = null; }}
    >
      {/* touch-action none: a swipe down on the top rows closes the card instead of scrolling the page */}
      <div style={{ touchAction: 'none' }}>
      <div className="flex items-start gap-1 pl-3 pr-1 pt-1">
        <div className="min-w-0 flex-1 pt-1.5" aria-live="polite">
          <p className="truncate text-[13px] font-semibold">{k.judul}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[14px] font-bold">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/15" style={{ background: k.warna }} />
            <span className="shrink-0 tabular-nums">{k.utama}</span>
            {k.kategori && <span className="min-w-0 truncate text-[12px] font-medium text-gray-700 dark:text-gray-300">{k.kategori}</span>}
            {k.indikatif && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">indikatif</span>}
          </p>
        </div>
        <button type="button" onClick={tutupKartu} aria-label="Tutup kartu ruas"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-2 pb-1.5 pl-3 pr-2">
        <p className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-300">{saran}</p>
        {k.rincian.length > 0 && (
          <button type="button" aria-expanded={rinci} onClick={() => setRinci((r) => !r)}
            className="min-h-8 shrink-0 rounded-full px-2 text-[12px] font-semibold text-teal-800 underline underline-offset-2 dark:text-teal-200">
            Rincian
          </button>
        )}
      </div>
      </div>
      {rinci && (
        <div className="max-h-[40vh] space-y-1.5 overflow-y-auto border-t border-gray-200 px-3 py-2 text-[12px] leading-snug text-gray-800 dark:border-gray-800 dark:text-gray-200" data-kartu-rincian>
          {k.rincian.map((r) => <p key={r}>{r}</p>)}
          {seri && 'svg' in seri && seri.svg && (
            <div>
              <p className="text-[11px] text-gray-700 dark:text-gray-300">Asap kendaraan 24 jam ke depan (jam prakiraan yang ada)</p>
              <div className="rounded bg-white p-1" dangerouslySetInnerHTML={{ __html: seri.svg }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
  // rendered next to the map's own overlay buttons (search, "Pakai lokasiku", "Rute di perangkat") so it sits above them
  return wadah ? createPortal(isi, wadah) : isi;
}
