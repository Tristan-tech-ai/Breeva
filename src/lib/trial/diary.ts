/**
 * The trial diary (task F4-07). The student trial (26 Nov-2 Dec 2026) has to measure on how many days each student
 * used the route cards and what the route with the least vehicle exhaust offered them, without accounts and without
 * the server (the proposal promises no name, no account, no home location). So the diary lives on the phone, is off
 * until the student turns it on at /uji-coba, keeps per day only the date, the modes, the region and two numbers per
 * route lookup (never a coordinate), and leaves the phone only as a short code the student copies for the teacher.
 * Pure and tested; storage is in ./storage.ts.
 */

export type Mode = 'walk' | 'motor';
export type Region = 'badung_denpasar' | 'kota_bogor';

/** One day: route lookups, which modes and regions, and per lookup the exhaust cut (%) and the extra minutes. */
export interface DayLog { n: number; flags: number; red: number[]; extra: number[] }
export interface Diary { on: boolean; id: number; days: Record<string, DayLog> }

export const FLAG = { walk: 1, motor: 2, badung_denpasar: 4, kota_bogor: 8 } as const;
/** Values kept per day for its medians; days kept on the phone; days put in one code (the most recent). */
export const PER_DAY = 40, KEEP_DAYS = 60, CODE_DAYS = 21;
export const PREFIX = 'BRV1-';
const EPOCH = Date.UTC(2026, 0, 1), DAY_MS = 86_400_000;

export function emptyDiary(id: number, on = false): Diary {
  return { on, id: id & 0xffff, days: {} };
}

/** The phone's own calendar day (a student in Bali counts WITA days, in Bogor WIB days). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * What one route lookup offered: the largest cut in exhaust dose among the routes shown against the fastest one
 * (positive = less exhaust breathed) and that route's extra minutes. One route only: the fastest is also the
 * cleanest, so 0 and 0. Null when the cards carry no exhaust comparison (the lookup still counts as use).
 */
export function lookupFromCards(cards: { vsFastest: { extraMin: number; exhDosePct: number | null } | null }[]): { red: number; extra: number } | null {
  if (!cards.length) return null;
  if (cards.length === 1) return { red: 0, extra: 0 };
  let best: { red: number; extra: number } | null = null;
  for (const c of cards) {
    const v = c.vsFastest;
    if (!v || v.exhDosePct == null) continue;
    const red = -v.exhDosePct;
    if (!best || red > best.red) best = { red, extra: v.extraMin };
  }
  return best;
}

/** Adds one route lookup to the diary (a new object); nothing happens while the diary is off. */
export function record(diary: Diary, now: Date, mode: Mode, region: Region | null, lookup: { red: number; extra: number } | null): Diary {
  if (!diary.on) return diary;
  const day = localDay(now);
  const old = diary.days[day] ?? { n: 0, flags: 0, red: [], extra: [] };
  const log: DayLog = {
    n: old.n + 1,
    flags: old.flags | FLAG[mode] | (region ? FLAG[region] : 0),
    red: lookup ? [...old.red, Math.round(lookup.red)].slice(-PER_DAY) : old.red,
    extra: lookup ? [...old.extra, Math.round(lookup.extra)].slice(-PER_DAY) : old.extra,
  };
  const days = { ...diary.days, [day]: log };
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  return { ...diary, days: Object.fromEntries(keep.map((k) => [k, days[k]])) };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One row per day, as the code carries it: the day's medians (whole numbers). */
export interface DayRow { day: string; n: number; flags: number; red: number | null; extra: number | null }

export function dayRows(diary: Pick<Diary, 'days'>): DayRow[] {
  return Object.keys(diary.days).sort().filter((d) => diary.days[d].n > 0).map((day) => {
    const l = diary.days[day], r = median(l.red), e = median(l.extra);
    return { day, n: l.n, flags: l.flags, red: r == null ? null : Math.round(r), extra: e == null ? null : Math.round(e) };
  });
}

export interface Summary { days: number; lookups: number; medianRed: number | null; medianExtra: number | null; first: string | null; last: string | null }

/** What the student sees: days used, lookups, and the median over the days of each day's median. */
export function summarize(rows: DayRow[]): Summary {
  const red = rows.map((r) => r.red).filter((x): x is number => x != null);
  const extra = rows.map((r) => r.extra).filter((x): x is number => x != null);
  return {
    days: rows.length, lookups: rows.reduce((s, r) => s + r.n, 0),
    medianRed: median(red), medianExtra: median(extra),
    first: rows[0]?.day ?? null, last: rows[rows.length - 1]?.day ?? null,
  };
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS);
}
function dayString(n: number): string {
  return new Date(EPOCH + n * DAY_MS).toISOString().slice(0, 10);
}
/** FNV-1a over the bytes, low 16 bits: catches a changed or dropped character when a code is retyped. */
function check16(bytes: number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h & 0xffff;
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const NONE = 255;

/**
 * The code for the teacher: BRV1- and base64url of [version, id (2 bytes), number of days, then per day: day number
 * since 2026-01-01 (2 bytes), lookups (cap 255), flags, exhaust cut + 100 (0..200, 255 = none), extra minutes
 * (0..254, 255 = none)], then a 2-byte checksum. The most recent CODE_DAYS days; no coordinate, no name.
 */
export function encode(id: number, rows: DayRow[]): string {
  const use = rows.slice(-CODE_DAYS);
  const b: number[] = [1, (id >> 8) & 0xff, id & 0xff, use.length];
  for (const r of use) {
    const dn = dayNumber(r.day);
    b.push((dn >> 8) & 0xff, dn & 0xff, clamp(r.n, 0, 255), r.flags & 0xff,
      r.red == null ? NONE : clamp(Math.round(r.red), -100, 100) + 100,
      r.extra == null ? NONE : clamp(Math.round(r.extra), 0, 254));
  }
  const c = check16(b);
  b.push((c >> 8) & 0xff, c & 0xff);
  const b64 = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return PREFIX + b64;
}

/** The code back to its rows, or null when it is not a BRV1 code or a character was changed or lost. */
export function decode(code: string): { id: number; rows: DayRow[] } | null {
  const s = code.trim();
  if (!s.startsWith(PREFIX)) return null;
  let raw: string;
  try {
    const b64 = s.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch { return null; }
  const b = Array.from(raw, (ch) => ch.charCodeAt(0));
  if (b.length < 6 || b[0] !== 1) return null;
  const k = b[3];
  if (b.length !== 4 + 6 * k + 2) return null;
  const body = b.slice(0, -2), c = (b[b.length - 2] << 8) | b[b.length - 1];
  if (check16(body) !== c) return null;
  const rows: DayRow[] = [];
  for (let i = 0; i < k; i++) {
    const o = 4 + 6 * i;
    rows.push({
      day: dayString((b[o] << 8) | b[o + 1]), n: b[o + 2], flags: b[o + 3],
      red: b[o + 4] === NONE ? null : b[o + 4] - 100, extra: b[o + 5] === NONE ? null : b[o + 5],
    });
  }
  return { id: (b[1] << 8) | b[2], rows };
}

/** All BRV1 codes in a text (a form export, a chat, one per line). */
export function findCodes(text: string): string[] {
  return text.match(/BRV1-[A-Za-z0-9_-]+/g) ?? [];
}

export interface Rekap {
  kode_terbaca: number; kode_ditolak: number; peserta: number;
  /** Gate G4: participants with at least 5 days of use inside the trial window. */
  peserta_min_5_hari: number;
  hari_per_peserta: number[];
  median_pengurangan_asap_pct: number | null; median_tambahan_menit: number | null;
  moda: { jalan_kaki: number; motor: number }; wilayah: { badung_denpasar: number; kota_bogor: number };
  jendela: [string, string];
}

/**
 * The teacher's tally. A student who sends a code twice is counted once (same phone: the code with more days wins).
 * A code without days is rejected. Days count only inside the trial window; medians are per participant first, then
 * over participants.
 */
export function rekap(codes: string[], window: [string, string] = ['2026-11-26', '2026-12-02']): Rekap {
  // same phone = same random id AND same first day (a later code of one student starts on the same day; two students
  // who drew the same 16-bit id almost never also started on the same day)
  const best = new Map<string, DayRow[]>();
  let bad = 0, ok = 0;
  for (const c of codes) {
    const d = decode(c);
    if (!d || !d.rows.length) { bad++; continue; }
    ok++;
    const key = `${d.id}|${d.rows[0].day}`, old = best.get(key);
    if (!old || d.rows.length > old.length || (d.rows.length === old.length && d.rows.at(-1)!.day > old.at(-1)!.day)) best.set(key, d.rows);
  }
  const days: number[] = [], reds: number[] = [], extras: number[] = [];
  const moda = { jalan_kaki: 0, motor: 0 }, wilayah = { badung_denpasar: 0, kota_bogor: 0 };
  for (const rows of best.values()) {
    const inWin = rows.filter((r) => r.day >= window[0] && r.day <= window[1]);
    days.push(inWin.length);
    const s = summarize(inWin);
    if (s.medianRed != null) reds.push(s.medianRed);
    if (s.medianExtra != null) extras.push(s.medianExtra);
    const f = rows.reduce((a, r) => a | r.flags, 0);
    if (f & FLAG.walk) moda.jalan_kaki++;
    if (f & FLAG.motor) moda.motor++;
    if (f & FLAG.badung_denpasar) wilayah.badung_denpasar++;
    if (f & FLAG.kota_bogor) wilayah.kota_bogor++;
  }
  return {
    kode_terbaca: ok, kode_ditolak: bad, peserta: best.size,
    peserta_min_5_hari: days.filter((n) => n >= 5).length,
    hari_per_peserta: days.sort((a, b) => b - a),
    median_pengurangan_asap_pct: median(reds), median_tambahan_menit: median(extras),
    moda, wilayah, jendela: window,
  };
}
