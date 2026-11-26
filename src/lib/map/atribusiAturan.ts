/**
 * M-U05: when the map attribution may fold (OSMF Attribution Guidelines 1.5.2, read 26 Nov 2026): never before it has
 * been shown; after five seconds, or on the first touch of the map that is not the (i) button itself.
 */
export const TUNDA_LIPAT_MS = 5000;

export function bolehLipat(msSejakTampil: number, sentuhPeta: boolean): boolean {
  return msSejakTampil >= TUNDA_LIPAT_MS || sentuhPeta;
}
