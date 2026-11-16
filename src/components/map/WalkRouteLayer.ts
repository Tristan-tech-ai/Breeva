import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { FIELD_REGIONS } from '../../lib/field/source';
import { RouteClient } from '../../lib/route/client';
import { routeCards, type RouteCard } from '../../lib/route/summary';

export interface WalkRoutingState { status: string; cards: RouteCard[]; ms?: number }

/**
 * Walking routes computed on the device: the first tap sets the start, the second the destination; the Web Worker
 * returns the Pareto routes (time vs NO2) and they are drawn, fastest orange, cleanest teal. A third tap starts again.
 * Registered on the map as __walkTap so the map's click handler hands taps here while the mode is on.
 */
export function useWalkRouting(map: L.Map | null, enabled: boolean, onState?: (s: WalkRoutingState) => void) {
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    if (!map || !enabled) return;
    const group = L.layerGroup().addTo(map);
    let client: RouteClient | null = null;
    const ready = new Map<string, Promise<unknown>>();
    let start: L.LatLng | null = null;
    let busy = false;
    const say = (s: WalkRoutingState) => onStateRef.current?.(s);
    say({ status: 'Ketuk titik berangkat di peta.', cards: [] });

    const regionOf = (ll: L.LatLng) => FIELD_REGIONS.find((r) => L.latLngBounds(r.bounds).contains(ll));
    const tapAt = (ll: L.LatLng): boolean => {
      if (busy) return true;
      if (!start) {
        group.clearLayers();
        start = ll;
        L.circleMarker(ll, { radius: 7, color: '#14213D', weight: 3, fillColor: '#F7F7F2', fillOpacity: 1 }).addTo(group);
        say({ status: 'Ketuk tujuan.', cards: [] });
        return true;
      }
      const from = start, to = ll;
      start = null;
      const region = regionOf(from);
      if (!region || regionOf(to) !== region) {
        say({ status: 'Rute di perangkat baru tersedia di dalam satu wilayah (Badung–Denpasar atau Kota Bogor).', cards: [] });
        return true;
      }
      busy = true;
      L.circleMarker(to, { radius: 7, color: '#14213D', weight: 3, fillColor: '#14213D', fillOpacity: 1 }).addTo(group);
      say({ status: 'Menghitung rute di perangkat…', cards: [] });
      client ??= new RouteClient();
      const c = client;
      let init = ready.get(region.name);
      if (!init) { init = c.init({ name: region.name, geometry: region.geometry }); ready.set(region.name, init); }
      init
        .then(() => c.route({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }))
        .then(({ routes, ms }) => {
          const cards = routeCards(routes);
          // draw the alternatives first, then the fastest, the cleanest last (on top)
          const last = cards.length - 1;
          const order = [...cards.keys()].filter((k) => k !== 0 && k !== last).concat(last > 0 ? [0, last] : [0]);
          for (const k of cards.length ? order : []) {
            const ll = routes[k].coords.map(([lon, lat]) => [lat, lon] as L.LatLngTuple);
            const w = k === 0 || k === last ? 6 : 4;
            L.polyline(ll, { color: '#ffffff', weight: w + 4, opacity: 0.95, interactive: false }).addTo(group);
            L.polyline(ll, { color: cards[k].color, weight: w, opacity: 1, interactive: false }).addTo(group);
          }
          say({ status: routes.length ? `${routes.length} rute dihitung di perangkat dalam ${Math.round(ms)} ms. Ketuk lagi untuk rute baru.` : 'Tidak ada rute.', cards, ms });
        })
        .catch((e: Error) => {
          ready.delete(region.name);
          say({ status: `Rute gagal: ${e.message}`, cards: [] });
        })
        .finally(() => { busy = false; });
      return true;
    };
    (map as unknown as { __walkTap?: { tapAt: (ll: L.LatLng) => boolean } }).__walkTap = { tapAt };
    return () => {
      delete (map as unknown as { __walkTap?: unknown }).__walkTap;
      group.remove();
      client?.terminate();
    };
  }, [map, enabled]);
}
