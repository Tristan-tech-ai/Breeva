/**
 * VAYU Engine — Cultural Calendar Module
 * Detects Indonesian cultural events and returns traffic modifiers.
 * ERD Section 8.1, 8.1.1, 8.2
 */

// Nyepi dates (Saka lunar calendar — hardcoded MVP)
const NYEPI_DATES: Record<number, string> = {
  2025: '2025-03-29',
  2026: '2026-03-19',
  2027: '2027-03-07',
  2028: '2028-03-26',
  2029: '2029-03-15',
};

// Lebaran (Hari Raya Idul Fitri) — hardcoded estimates
const LEBARAN_DATES: Record<number, string> = {
  2025: '2025-03-31',
  2026: '2026-03-21',
  2027: '2027-03-10',
  2028: '2028-02-27',
  2029: '2029-02-15',
};

// Galungan reference date (Rabu Kliwon Dungulan, every 210 days)
const GALUNGAN_REFERENCE = new Date('2025-01-15');
const PAWUKON_CYCLE = 210;

// Diurnal hourly traffic modifiers (ERD 8.2)
const HOURLY_TRAFFIC: Record<number, number> = {
  0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.12,
  5: 0.35, 6: 0.85, 7: 1.20, 8: 1.40, 9: 1.10,
  10: 0.90, 11: 0.95, 12: 1.15, 13: 1.10, 14: 0.85,
  15: 0.90, 16: 1.20, 17: 1.50, 18: 1.60, 19: 1.30,
  20: 1.10, 21: 0.80, 22: 0.55, 23: 0.30,
};

interface CulturalModifier {
  event: string | null;
  trafficMultiplier: number;
  diurnalMultiplier: number;
  combined: number;
}

/** Check if date is during Nyepi (Bali only) */
function isNyepi(date: Date): boolean {
  const nyepi = NYEPI_DATES[date.getFullYear()];
  if (!nyepi) return false;
  const d = date.toISOString().slice(0, 10);
  return d === nyepi;
}

/** Check if date falls within Lebaran window (H-2 to H+2) */
function getLebaranModifier(date: Date): number | null {
  const lebaran = LEBARAN_DATES[date.getFullYear()];
  if (!lebaran) return null;
  const lebaranDate = new Date(lebaran + 'T00:00:00');
  const diff = Math.round((date.getTime() - lebaranDate.getTime()) / 86400000);
  // H-3 to H-1: mudik puncak (4.2x)
  if (diff >= -3 && diff <= -1) return 4.2;
  // H-2 to H+2 (excluding mudik): 3.5x
  if (diff >= 0 && diff <= 2) return 3.5;
  return null;
}

/** Check if date is near Galungan (Bali, pawukon 210-day cycle) */
function isNearGalungan(date: Date): boolean {
  const diffDays = Math.round(
    (date.getTime() - GALUNGAN_REFERENCE.getTime()) / 86400000
  );
  const mod = ((diffDays % PAWUKON_CYCLE) + PAWUKON_CYCLE) % PAWUKON_CYCLE;
  // Galungan day (0) and Kuningan (10 days after)
  return mod <= 1 || (mod >= 10 && mod <= 11);
}

/** Check if it's New Year's Eve/Day */
function isNewYear(date: Date): boolean {
  const m = date.getMonth();
  const d = date.getDate();
  return (m === 11 && d === 31) || (m === 0 && d === 1);
}

/**
 * Get cultural + diurnal traffic modifier for a given time and region.
 * Returns a combined multiplier (0.0 – ~6.7).
 * 0.0 = no traffic (Nyepi), 1.0 = normal baseline.
 */
export function getCulturalModifier(
  date: Date,
  region: string
): CulturalModifier {
  const hour = date.getHours();
  const diurnalMultiplier = HOURLY_TRAFFIC[hour] ?? 1.0;

  const isBaliRegion = region === 'bali';

  // Nyepi: zero traffic (Bali only)
  if (isBaliRegion && isNyepi(date)) {
    return {
      event: 'Nyepi',
      trafficMultiplier: 0.0,
      diurnalMultiplier,
      combined: 0.0,
    };
  }

  // Lebaran window (nationwide)
  const lebaranMod = getLebaranModifier(date);
  if (lebaranMod !== null) {
    return {
      event: lebaranMod >= 4.0 ? 'Mudik Puncak' : 'Lebaran',
      trafficMultiplier: lebaranMod,
      diurnalMultiplier,
      combined: lebaranMod * diurnalMultiplier,
    };
  }

  // Galungan/Kuningan (Bali only)
  if (isBaliRegion && isNearGalungan(date)) {
    return {
      event: 'Galungan/Kuningan',
      trafficMultiplier: 1.6,
      diurnalMultiplier,
      combined: 1.6 * diurnalMultiplier,
    };
  }

  // New Year's Eve/Day (nationwide)
  if (isNewYear(date)) {
    return {
      event: 'Tahun Baru',
      trafficMultiplier: 2.8,
      diurnalMultiplier,
      combined: 2.8 * diurnalMultiplier,
    };
  }

  // Normal day
  return {
    event: null,
    trafficMultiplier: 1.0,
    diurnalMultiplier,
    combined: diurnalMultiplier,
  };
}

/** Get diurnal traffic modifier for a given hour (0-23) */
export function getDiurnalModifier(hour: number): number {
  return HOURLY_TRAFFIC[hour] ?? 1.0;
}
