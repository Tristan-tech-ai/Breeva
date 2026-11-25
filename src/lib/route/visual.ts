/** Short labels for the visual route cards (N-03): one glance shows the result, the sentences live under "Rincian". */
import type { RouteCard } from './summary';

/** Exhaust dose of each route relative to the fastest (fastest = 1); null when a route has no exhaust data. */
export function doseRatios(cards: RouteCard[]): (number | null)[] {
  return cards.map((c, k) => {
    if (k === 0) return c.exh != null ? 1 : null;
    const p = c.vsFastest?.exhDosePct;
    return p == null ? null : Math.max(0, Math.round(100 + p) / 100);
  });
}

/** The big chip of a card: "−66% asap", "+12% asap", "≈ sama", "patokan" or "tanpa data". */
export function doseChip(card: RouteCard, k: number): { text: string; tone: 'good' | 'bad' | 'same' | 'base' | 'none' } {
  if (k === 0) return card.exh == null ? { text: 'tanpa data', tone: 'none' } : { text: 'patokan', tone: 'base' };
  const p = card.vsFastest?.exhDosePct;
  if (p == null) return { text: 'tanpa data', tone: 'none' };
  if (p <= -5) return { text: `−${-p}% asap`, tone: 'good' };
  if (p >= 5) return { text: `+${p}% asap`, tone: 'bad' };
  return { text: '≈ sama', tone: 'same' };
}

/** Extra minutes against the fastest as a chip, or null when the same. */
export function timeChip(card: RouteCard): string | null {
  const m = card.vsFastest?.extraMin;
  if (m == null || m === 0) return null;
  return m > 0 ? `+${m} mnt` : `−${-m} mnt`;
}

/** The school-zone cost as a short chip from the full sentence (schoolCostText), or null. */
export function schoolChip(card: RouteCard): string | null {
  if (!card.schoolCost) return card.schoolNote ? 'zona sekolah' : null;
  const s = card.schoolCost;
  if (s.startsWith('Zona sekolah tidak mengubah')) return 'zona sekolah: tetap';
  const add = s.match(/^Zona sekolah menambah (.+?) dibanding/);
  if (add) return `zona sekolah +${add[1].replace(' dan ', ', ').replace(' menit', ' mnt')}`;
  if (s.startsWith('Zona sekolah mengubah jalannya')) return 'zona sekolah: jalan lain';
  return 'zona sekolah: rute berubah';
}

/** Leave-later hint as a chip: "07.00: −20%". */
export function soonChip(card: RouteCard): string | null {
  const m = card.soonHint?.match(/jam (\d{2}\.\d{2}) .*?(\d+)% lebih sedikit/);
  return m ? `berangkat ${m[1]}: −${m[2]}%` : null;
}
