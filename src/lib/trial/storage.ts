/**
 * The trial diary on this phone (task F4-07): localStorage only, every access guarded (private windows and blocked
 * site data throw or come back empty; the app must work without it). Nothing here sends anything anywhere.
 */
import { FIELD_REGIONS } from '../field/source';
import { emptyDiary, lookupFromCards, record, type Diary, type Mode, type Region } from './diary';

export const KEY = 'breeva.ujiCoba.catatan.v1';

function randomId(): number {
  try {
    const a = new Uint16Array(1);
    crypto.getRandomValues(a);
    return a[0];
  } catch {
    return Math.floor(Math.random() * 0x10000);
  }
}

export function loadDiary(): Diary {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Diary;
      if (d && typeof d.id === 'number' && d.days && typeof d.days === 'object') return { on: !!d.on, id: d.id, days: d.days };
    }
  } catch { /* unreadable: start empty */ }
  return emptyDiary(randomId());
}

export function saveDiary(d: Diary): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function setDiaryOn(on: boolean): Diary {
  const d = { ...loadDiary(), on };
  saveDiary(d);
  return d;
}

/** Forget everything, including the device id (a new one is drawn when the diary is turned on again). */
export function clearDiary(): Diary {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  return emptyDiary(randomId());
}

/** Which field region a point is in (used to set a region flag; the point itself is not kept). */
export function regionOf(p: { lat: number; lng: number } | null | undefined): Region | null {
  if (!p) return null;
  const r = FIELD_REGIONS.find((x) => x.bounds[0][0] <= p.lat && p.lat <= x.bounds[1][0] && x.bounds[0][1] <= p.lng && p.lng <= x.bounds[1][1]);
  return (r?.name as Region | undefined) ?? null;
}

let last = { sig: '', at: 0 };

/**
 * Called when route cards appear on /peta. Records one lookup while the diary is on; the same cards delivered again
 * within a minute (a re-render, a status line change) are not counted twice.
 */
export function noteRouteLookup(cards: { minutes: number; km: string; vsFastest: { extraMin: number; exhDosePct: number | null } | null }[], mode: Mode, from: { lat: number; lng: number } | null | undefined, now = new Date()): boolean {
  if (!cards.length) return false;
  const d = loadDiary();
  if (!d.on) return false;
  const sig = `${mode}|${cards.map((c) => `${c.minutes}:${c.km}:${c.vsFastest?.exhDosePct ?? ''}`).join(',')}`;
  if (sig === last.sig && now.getTime() - last.at < 60_000) return false;
  last = { sig, at: now.getTime() };
  return saveDiary(record(d, now, mode, regionOf(from), lookupFromCards(cards)));
}
