// Who may hold back an automatic reload when a new build takes over (M-U00).
// Stores register a check at module load (an active walk, a route being computed); pwa.ts asks before reloading.
type Penjaga = () => boolean;
const penjaga: Penjaga[] = [];

export function daftarPenjaga(fn: Penjaga): void {
  penjaga.push(fn);
}

export function adaYangMenahan(): boolean {
  return penjaga.some((fn) => {
    try { return fn(); } catch { return false; }
  });
}

/** Reload now only when nothing holds it back and no automatic reload ran in the last 30 s (no loops). */
export function bolehMuatUlang(k: { menahan: boolean; terakhirMuatUlang: number; sekarang: number }): boolean {
  return !k.menahan && k.sekarang - k.terakhirMuatUlang > 30_000;
}

/** Only for tests. */
export function _kosongkanPenjaga(): void {
  penjaga.length = 0;
}
