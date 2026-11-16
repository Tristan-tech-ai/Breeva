/**
 * Departure choices of the route cards (task F3-08): now, or the school entry and exit hours, where the school zone of
 * motor routes applies. The choice travels in the route link as berangkat=HH:MM.
 */
import { SCHOOL_HOURS } from './schoolZone';

export interface DepartChoice { value: string | null; label: string }

export const DEPART_CHOICES: DepartChoice[] = [
  { value: null, label: 'Sekarang' },
  { value: '06:45', label: '06.45 (masuk sekolah)' },
  { value: '12:30', label: '12.30 (pulang sekolah)' },
];

/** A valid "HH:MM" from the link, else null (now). */
export function parseDepart(s: string | null | undefined): string | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s ?? '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** True when a local clock time falls in the school hours (the motor school zone applies). */
export function inSchoolHours(hhmm: string | null): boolean {
  const v = parseDepart(hhmm);
  if (!v) return false;
  const min = Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  return SCHOOL_HOURS.some(([a, b]) => min >= a && min < b);
}
