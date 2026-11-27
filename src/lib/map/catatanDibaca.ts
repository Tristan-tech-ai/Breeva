/**
 * M-U18: whether a one-time map note was closed on this device (localStorage, safe when storage is blocked). Pure, so it
 * is tested without Leaflet; the note itself is lib/map/catatanSekali.ts.
 */
const KUNCI = (nama: string) => `breeva_catatan_${nama}`;

export interface Simpanan { getItem(k: string): string | null; setItem(k: string, v: string): void }

function simpanan(): Simpanan | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** True when the note was closed on this device before. */
export function sudahDibaca(nama: string, s: Simpanan | null = simpanan()): boolean {
  try { return s?.getItem(KUNCI(nama)) === '1'; } catch { return false; }
}

/** Remembers that the note was closed. */
export function tandaiDibaca(nama: string, s: Simpanan | null = simpanan()): void {
  try { s?.setItem(KUNCI(nama), '1'); } catch { /* storage blocked: closed for this page only */ }
}

