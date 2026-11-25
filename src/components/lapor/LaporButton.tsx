import { lazy, Suspense, useState } from 'react';
import { Megaphone } from 'lucide-react';

const LaporSheet = lazy(() => import('./LaporSheet'));

/** N-12: the 'Laporkan' button; the form loads only when tapped. `getCenter` gives the place to report when GPS is not used. */
export default function LaporButton({ getCenter, className = '' }: { getCenter: () => { lat: number; lng: number } | null; className?: string }) {
  const [open, setOpen] = useState<{ lat: number; lng: number } | null | false>(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(getCenter())} data-lapor
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-700 px-3 text-xs font-bold text-white shadow-sm ${className}`}>
        <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />Laporkan asap
      </button>
      {open !== false && (
        <Suspense fallback={null}>
          <LaporSheet center={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
