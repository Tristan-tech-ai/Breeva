/**
 * Route links: ?rute=<lat>,<lng>~<lat>,<lng>&moda=motor opens the map with that on-device route computed (a teacher
 * can send the route to school; the demo recording uses it too). Optional &berangkat=HH:MM sets the departure.
 */
export interface LatLng { lat: number; lng: number }
export interface RouteLink { from: LatLng; to: LatLng; mode: 'walk' | 'motor' }

const point = (s: string): LatLng | null => {
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

export function parseRouteLink(search: string): RouteLink | null {
  const q = new URLSearchParams(search);
  const parts = (q.get('rute') ?? '').split('~');
  if (parts.length !== 2) return null;
  const from = point(parts[0]), to = point(parts[1]);
  if (!from || !to) return null;
  return { from, to, mode: q.get('moda') === 'motor' ? 'motor' : 'walk' };
}

/** A destination link (?sekolah=lat,lng,name): the map opens with that school or facility as the destination. */
export interface DestLink { lat: number; lng: number; name: string }

export function destLink(originPath: string, d: DestLink): string {
  const q = new URLSearchParams({ sekolah: `${d.lat.toFixed(5)},${d.lng.toFixed(5)},${d.name}` });
  return `${originPath}?${q.toString().replace(/%2C/g, ',')}`;
}

export function parseDestLink(search: string): DestLink | null {
  const v = new URLSearchParams(search).get('sekolah');
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),(.+)$/.exec(v ?? '');
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]), name = m[3].trim().slice(0, 120);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && name ? { lat, lng, name } : null;
}

/** A map view link (?pusat=lat,lng[,zoom]): the map opens there, e.g. to show one street at zoom 17. Zoom 3-19, default 15. */
export interface ViewLink { lat: number; lng: number; zoom: number }

export function parseViewLink(search: string): ViewLink | null {
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d{1,2}))?$/.exec((new URLSearchParams(search).get('pusat') ?? '').trim());
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]), zoom = m[3] ? Number(m[3]) : 15;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && zoom >= 3 && zoom <= 19 ? { lat, lng, zoom } : null;
}

/** Link to a route on the map page at origin + path (5 decimals, about 1 m). */
export function routeLink(originPath: string, l: RouteLink, departLocal?: string | null): string {
  const f = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const q = new URLSearchParams({ rute: `${f(l.from)}~${f(l.to)}` });
  if (l.mode === 'motor') q.set('moda', 'motor');
  if (departLocal) q.set('berangkat', departLocal);
  return `${originPath}?${q.toString().replace(/%2C/g, ',').replace(/%7E/gi, '~').replace(/%3A/g, ':')}`;
}
