import { useEffect, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { wheelStep } from '../../lib/map/wheel';

/**
 * For a map inside a scrolling page: the wheel scrolls the page, Ctrl/Cmd + wheel (or a trackpad pinch) zooms the map,
 * and +/- buttons are shown. A short hint appears when the wheel is used without the modifier.
 */
export default function WheelGuard() {
  const map = useMap();
  const [hint, setHint] = useState(false);

  useEffect(() => {
    map.scrollWheelZoom.disable();
    const zoom = L.control.zoom({ position: 'bottomright', zoomInTitle: 'Perbesar', zoomOutTitle: 'Perkecil' }).addTo(map);
    const el = map.getContainer();
    let acc = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      const r = wheelStep(acc, e);
      acc = r.acc;
      if (r.hint) {
        setHint(true);
        clearTimeout(timer);
        timer = setTimeout(() => setHint(false), 1400);
        return; // the page scrolls
      }
      e.preventDefault();
      if (r.step) map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + r.step);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
      zoom.remove();
      map.scrollWheelZoom.enable();
    };
  }, [map]);

  if (!hint) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[700] flex items-center justify-center bg-black/35" aria-hidden>
      <p className="rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white">Tahan Ctrl (⌘ di Mac) lalu gulir untuk memperbesar peta</p>
    </div>
  );
}
