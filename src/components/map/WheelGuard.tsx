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
    // Listen in the capture phase on the map's parent, so the event is handled before any wheel handler of the map
    // itself: disabling scrollWheelZoom alone did not hold on a fast first load (the rotate plugin re-enables its
    // handler), and the map then zoomed out 7 levels while the visitor scrolled the page (cursorcam check, 16 Nov).
    const host = el.parentElement ?? el;
    let acc = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof Node) || !el.contains(e.target)) return;
      e.stopPropagation(); // Leaflet never sees the wheel; the default action (page scroll) still happens
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
    host.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      host.removeEventListener('wheel', onWheel, { capture: true });
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
