import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { FIELD_REGIONS } from '../../lib/field/source';
import { ROUTE_SETTLED_EVENT } from '../../lib/field/firstDraw';
import { COMPUTING, routeLoadingText } from '../../lib/route/loadProgress';
import { RouteClient, withSoon, type SoonHours, type WalkRoute } from '../../lib/route/client';
import { routeCards, type RouteCard } from '../../lib/route/summary';
import type { RouteLink } from '../../lib/route/share';
import { chooseDest, onTap, startFrom, type TapState } from '../../lib/route/tapFlow';

/** A fixed destination chosen from a list ("Ke sekolah"): the next tap is the start. */
export interface RouteDest { lat: number; lng: number; name: string }

export interface WalkRoutingState {
  status: string; cards: RouteCard[]; ms?: number;
  /** Start and destination of the routes shown, for the route link. */
  ends?: { from: { lat: number; lng: number }; to: { lat: number; lng: number } };
  /** The routes behind the cards (same order): geometry, length, time and means, e.g. to start a walk along one. */
  routes?: WalkRoute[];
}

/**
 * Walking routes computed on the device: the first tap sets the start, the second the destination; the Web Worker
 * returns the Pareto routes (time vs NO2) and they are drawn, fastest orange, cleanest teal. A third tap starts again.
 * Registered on the map as __walkTap so the map's click handler hands taps here while the mode is on. A route link
 * (?rute=, share.ts) is played as the two taps once, and the map fits both ends. With a fixed destination (dest, the
 * school picker) every tap is a start and the route goes to that destination. Switching walk/motor recomputes the
 * routes shown. With a fixed destination, a start given by the app (start, e.g. the user's position) is used at once
 * instead of waiting for a tap: when routing turns on, when the destination changes, and when a start first appears;
 * taps still set a new start.
 */
export function useWalkRouting(
  map: L.Map | null, enabled: boolean, onState?: (s: WalkRoutingState) => void, mode: 'walk' | 'motor' = 'walk',
  link?: RouteLink | null, dest?: RouteDest | null, depart?: string | null, start?: { lat: number; lng: number } | null,
) {
  const departRef = useRef(depart ?? null);
  departRef.current = depart ?? null;
  const linkRef = useRef(link);
  const apiRef = useRef<{
    setDest: (d: RouteDest | null) => void; rerun: () => void;
    startAt: (p: { lat: number; lng: number }, onlyIfIdle?: boolean) => void;
  } | null>(null);
  const startRef = useRef(start ?? null);
  startRef.current = start ?? null;
  const destRef = useRef(dest ?? null);
  destRef.current = dest ?? null;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!map || !enabled) return;
    const group = L.layerGroup().addTo(map);
    let client: RouteClient | null = null;
    const ready = new Map<string, Promise<unknown>>();
    let tap: TapState = { start: null, fixed: null };
    let fixed: RouteDest | null = null;
    let lastEnds: { from: L.LatLng; to: L.LatLng } | null = null;
    let busy = false;
    // a start given while a route is being computed runs when that one is done
    let queued: { lat: number; lng: number } | null = null;
    // each request is numbered so a leave-later hint arriving late only updates the cards it belongs to (F3-18)
    let reqSeq = 0;
    // cards of the current request are on screen: a late progress message must not replace them (X-W4)
    let lastShownCards = false;
    const say = (s: WalkRoutingState) => onStateRef.current?.(s);
    const destMarker = () => {
      if (!fixed) return;
      L.circleMarker([fixed.lat, fixed.lng], { radius: 9, color: '#0f766e', weight: 4, fillColor: '#ffffff', fillOpacity: 1 })
        .bindTooltip(fixed.name, { permanent: true, direction: 'top', offset: [0, -8] }).addTo(group);
    };
    const startMarker = (ll: L.LatLng) =>
      L.circleMarker(ll, { radius: 7, color: '#14213D', weight: 3, fillColor: '#F7F7F2', fillOpacity: 1 }).addTo(group);
    const endMarker = (ll: L.LatLng) =>
      L.circleMarker(ll, { radius: 7, color: '#14213D', weight: 3, fillColor: '#14213D', fillOpacity: 1 }).addTo(group);
    say({ status: 'Ketuk titik berangkat di peta.', cards: [] });

    const regionOf = (ll: L.LatLng) => FIELD_REGIONS.find((r) => L.latLngBounds(r.bounds).contains(ll));
    const tapAt = (ll: L.LatLng): boolean => {
      if (busy) return true;
      const r = onTap(tap, ll);
      const firstOfPair = !tap.fixed && !tap.start;
      tap = r.state;
      if (firstOfPair || tap.fixed) group.clearLayers();
      if (firstOfPair || tap.fixed) startMarker(ll);
      if (tap.fixed) destMarker();
      if (r.prompt) say({ status: r.prompt, cards: [] });
      if (r.compute) {
        if (!tap.fixed) endMarker(ll);
        compute(L.latLng(r.compute.from), L.latLng(r.compute.to));
      }
      return true;
    };
    const compute = (from: L.LatLng, to: L.LatLng) => {
      const region = regionOf(from);
      if (!region || regionOf(to) !== region) {
        say({ status: 'Rute di perangkat baru tersedia di dalam satu wilayah (Badung–Denpasar atau Kota Bogor).', cards: [] });
        return;
      }
      busy = true;
      lastEnds = { from, to };
      say({ status: COMPUTING, cards: [] });
      client ??= new RouteClient();
      const c = client;
      const req = ++reqSeq;
      let init = ready.get(region.name);
      if (!init) {
        // the first route of a region waits for its files: after 3 s the card says what is downloading (X-W4)
        const t0 = Date.now();
        init = c.init({ name: region.name, geometry: region.geometry }, undefined, (bytes) => {
          if (req === reqSeq && !lastShownCards) say({ status: routeLoadingText(bytes, Date.now() - t0), cards: [] });
        });
        ready.set(region.name, init);
      }
      lastShownCards = false;
      let shown: WalkRoutingState | null = null;
      let early: SoonHours | null = null;
      // F1-56: a first route may come drawn through its nodes; its real shapes follow and replace the lines
      const lines: L.Polyline[][] = [];
      const onShapes = (coords: Array<Array<[number, number]>>) => {
        if (req !== reqSeq || !shown?.routes || coords.length !== shown.routes.length) return;
        coords.forEach((c, k) => { const ll = c.map(([lon, lat]) => [lat, lon] as L.LatLngTuple); for (const pl of lines[k] ?? []) pl.setLatLngs(ll); });
        shown = { ...shown, routes: shown.routes.map((r, k) => ({ ...r, coords: coords[k] })) };
        say(shown); // the same cards: the trial diary does not count it again (storage.ts, same signature within 60 s)
      };
      const onSoon = (soon: SoonHours) => {
        if (req !== reqSeq) return; // a newer request replaced these cards
        if (!shown?.routes) { early = soon; return; }
        const routes2 = withSoon(shown.routes, soon);
        shown = { ...shown, routes: routes2, cards: routeCards(routes2) };
        say(shown);
      };
      init
        .then(() => c.route({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, modeRef.current, departRef.current, onSoon, onShapes))
        .then(({ routes, ms }) => {
          const cards = routeCards(routes);
          // draw the alternatives first, then the fastest, the cleanest last (on top)
          const last = cards.length - 1;
          const order = [...cards.keys()].filter((k) => k !== 0 && k !== last).concat(last > 0 ? [0, last] : [0]);
          for (const k of cards.length ? order : []) {
            const ll = routes[k].coords.map(([lon, lat]) => [lat, lon] as L.LatLngTuple);
            const w = k === 0 || k === last ? 6 : 4;
            lines[k] = [
              L.polyline(ll, { color: '#ffffff', weight: w + 4, opacity: 0.95, interactive: false }).addTo(group),
              L.polyline(ll, { color: cards[k].color, weight: w, opacity: 1, interactive: false }).addTo(group),
            ];
          }
          const again = fixed ? `Ketuk titik berangkat lain untuk rute baru ke ${fixed.name}.` : 'Ketuk lagi untuk rute baru.';
          shown = { status: routes.length ? `${routes.length} rute dihitung di perangkat dalam ${Math.round(ms)} ms. ${again}` : 'Tidak ada rute.', cards, ms,
            ends: { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng } }, routes };
          lastShownCards = true;
          say(shown);
          if (early) { const s = early; early = null; onSoon(s); }
        })
        .catch((e: Error) => {
          ready.delete(region.name);
          say({ status: `Rute gagal: ${e.message}`, cards: [] });
        })
        .finally(() => {
          busy = false;
          // the base map and the other regions of a route link wait for this (F1-53)
          window.dispatchEvent(new Event(ROUTE_SETTLED_EVENT));
          if (queued) { const q = queued; queued = null; startAt(q); }
        });
    };
    // a start from the app: a tap on the start towards the fixed destination, with both ends in view
    const startAt = (p: { lat: number; lng: number }, onlyIfIdle = false) => {
      if (onlyIfIdle && (lastEnds || busy)) return;
      if (!startFrom(tap, p) || !fixed) return;
      if (busy) { queued = p; return; }
      const ll = L.latLng(p.lat, p.lng);
      // only the full-screen app map gives a start: keep both ends clear of its header and of the route sheet
      // that covers the lower half
      const h = map.getSize().y;
      map.fitBounds(L.latLngBounds(ll, L.latLng(fixed.lat, fixed.lng)), {
        paddingTopLeft: [40, 80], paddingBottomRight: [40, Math.round(h / 2) + 24], maxZoom: 16,
      });
      tapAt(ll);
    };
    const setDest = (d: RouteDest | null) => {
      const c = chooseDest(d);
      tap = c.state;
      fixed = d;
      lastEnds = null;
      group.clearLayers();
      say({ status: c.prompt, cards: [] });
      if (!d) return;
      destMarker();
      map.setView([d.lat, d.lng], Math.max(map.getZoom(), 15));
    };
    // switching walk/motor recomputes the routes shown (same start and destination)
    const rerun = () => {
      if (!lastEnds || busy) return;
      const { from, to } = lastEnds;
      group.clearLayers();
      startMarker(from);
      if (fixed) destMarker();
      else endMarker(to);
      compute(from, to);
    };
    apiRef.current = { setDest, rerun, startAt };
    (map as unknown as { __walkTap?: { tapAt: (ll: L.LatLng) => boolean } }).__walkTap = { tapAt };
    if (destRef.current) setDest(destRef.current);
    if (destRef.current && startRef.current) startAt(startRef.current);
    const l = linkRef.current;
    if (l) {
      linkRef.current = null; // once
      const a = L.latLng(l.from.lat, l.from.lng), b = L.latLng(l.to.lat, l.to.lng);
      map.fitBounds(L.latLngBounds(a, b), { padding: [48, 48], maxZoom: 16 });
      tapAt(a); tapAt(b);
    }
    return () => {
      apiRef.current = null;
      delete (map as unknown as { __walkTap?: unknown }).__walkTap;
      group.remove();
      client?.terminate();
    };
  }, [map, enabled]);

  // react to changes only: on mount the main effect has already applied dest (and a route link must not be wiped)
  const destKey = dest ? `${dest.lat},${dest.lng},${dest.name}` : '';
  const seenDest = useRef(destKey);
  const seenMode = useRef(mode);
  const seenDepart = useRef(depart ?? null);
  useEffect(() => {
    if (seenDest.current === destKey) return;
    seenDest.current = destKey;
    apiRef.current?.setDest(destRef.current);
    if (destRef.current && startRef.current) apiRef.current?.startAt(startRef.current);
  }, [destKey]);
  // a start that appears later (the first GPS fix) is used once, if no route was computed yet; later moves are not
  const hasStart = !!start;
  const seenStart = useRef(hasStart);
  useEffect(() => {
    if (seenStart.current === hasStart) return;
    seenStart.current = hasStart;
    if (startRef.current) apiRef.current?.startAt(startRef.current, true);
  }, [hasStart]);
  useEffect(() => {
    if (seenMode.current === mode) return;
    seenMode.current = mode;
    apiRef.current?.rerun();
  }, [mode]);
  useEffect(() => {
    if (seenDepart.current === (depart ?? null)) return;
    seenDepart.current = depart ?? null;
    apiRef.current?.rerun();
  }, [depart]);
}
