/**
 * A position rounded before it leaves the device (task F3-14): the air-quality card is read from a model grid of
 * several kilometres, so two decimals (about 1.1 km) lose nothing and the server never sees where the user stands.
 */
export function coarsePoint(p: { lat: number; lng: number }, decimals = 2): { lat: number; lng: number } {
  const f = 10 ** decimals;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}
