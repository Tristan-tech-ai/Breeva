/**
 * What a tap on the map means while on-device routing is on (pure; used by WalkRouteLayer and tested):
 * without a fixed destination the first tap is the start and the second the destination; with one (a school chosen
 * from the list) every tap is a new start towards it.
 */
export interface P { lat: number; lng: number }
export interface TapState { start: P | null; fixed: (P & { name: string }) | null }
export interface TapResult { state: TapState; compute: { from: P; to: P } | null; prompt: string | null }

export function onTap(s: TapState, ll: P): TapResult {
  if (s.fixed) return { state: { start: null, fixed: s.fixed }, compute: { from: ll, to: { lat: s.fixed.lat, lng: s.fixed.lng } }, prompt: null };
  if (!s.start) return { state: { start: ll, fixed: null }, compute: null, prompt: 'Ketuk tujuan.' };
  return { state: { start: null, fixed: null }, compute: { from: s.start, to: ll }, prompt: null };
}

/** Choosing (or clearing) a fixed destination forgets a half-set start. */
export function chooseDest(d: (P & { name: string }) | null): { state: TapState; prompt: string } {
  return {
    state: { start: null, fixed: d },
    prompt: d ? `Tujuan: ${d.name}. Ketuk titik berangkat di peta (rumah, kos, atau halte).` : 'Ketuk titik berangkat di peta.',
  };
}
