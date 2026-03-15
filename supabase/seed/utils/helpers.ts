export function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomFloat(min: number, max: number, decimals = 2): number {
  const val = Math.random() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
}

/** Return a Date offset from now by a random number of days in [daysFrom, daysTo] */
export function randomDate(daysFrom: number, daysTo: number): Date {
  const now = Date.now();
  const offset = randomBetween(daysFrom, daysTo);
  return new Date(now + offset * 86_400_000);
}

/** ISO string for Supabase timestamptz columns */
export function randomTimestamp(daysFrom: number, daysTo: number): string {
  return randomDate(daysFrom, daysTo).toISOString();
}

/** ISO date string (YYYY-MM-DD) */
export function randomDateStr(daysFrom: number, daysTo: number): string {
  return randomDate(daysFrom, daysTo).toISOString().split('T')[0];
}

export function generateIndonesianPhone(): string {
  const prefixes = ['0812', '0813', '0821', '0857', '0858', '0878'];
  return `${randomFrom(prefixes)}${randomBetween(10_000_000, 99_999_999)}`;
}

/** Small random coordinate jitter (±offset degrees) */
export function jitter(value: number, offset = 0.002): number {
  return parseFloat((value + (Math.random() - 0.5) * 2 * offset).toFixed(7));
}

export function generateQrCode(): string {
  const hex = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('').toUpperCase();
  return `BRV-${hex}`;
}

export function generateBackupCode(): string {
  return Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('').toUpperCase();
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}
