import { describe, expect, it } from 'vitest';
import { CODE_DAYS, FLAG, PREFIX, dayRows, decode, emptyDiary, encode, findCodes, localDay, lookupFromCards, record, rekap, summarize } from '../src/lib/trial/diary';

const at = (d: string, h = 7) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`);
const card = (extraMin: number, exhDosePct: number | null) => ({ vsFastest: { extraMin, exhDosePct } });

describe('trial diary (F4-07)', () => {
  it('records nothing while off (the default)', () => {
    const d = emptyDiary(7);
    expect(d.on).toBe(false);
    expect(record(d, at('2026-11-26'), 'walk', 'badung_denpasar', { red: 30, extra: 2 })).toBe(d);
  });

  it('keeps only date, modes, region and two numbers: no coordinate anywhere', () => {
    let d = emptyDiary(7, true);
    d = record(d, at('2026-11-26'), 'walk', 'badung_denpasar', { red: 31, extra: 2 });
    d = record(d, at('2026-11-26', 15), 'motor', 'badung_denpasar', { red: 12, extra: 5 });
    expect(d.days['2026-11-26']).toEqual({ n: 2, flags: FLAG.walk | FLAG.motor | FLAG.badung_denpasar, red: [31, 12], extra: [2, 5] });
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/lat|lng|-8\.\d|115\.\d|-6\.\d|106\.\d/);
  });

  it('a lookup offers the largest exhaust cut among the routes shown, with its extra minutes', () => {
    expect(lookupFromCards([{ vsFastest: null }, card(1, -12), card(4, -35)])).toEqual({ red: 35, extra: 4 });
    expect(lookupFromCards([{ vsFastest: null }])).toEqual({ red: 0, extra: 0 });
    expect(lookupFromCards([{ vsFastest: null }, card(2, null)])).toBeNull();
    expect(lookupFromCards([])).toBeNull();
  });

  it('counts days by the phone calendar (a WITA morning is the same local day)', () => {
    expect(localDay(new Date(2026, 10, 26, 0, 30))).toBe('2026-11-26');
    expect(localDay(new Date(2026, 10, 26, 23, 59))).toBe('2026-11-26');
  });

  it('encode and decode round-trip; the code carries the day medians and no more', () => {
    let d = emptyDiary(0xbeef, true);
    for (const [day, red, extra] of [['2026-11-26', 30, 2], ['2026-11-26', 40, 4], ['2026-11-27', 25, 1], ['2026-11-29', -3, 0]] as const) d = record(d, at(day), 'walk', 'kota_bogor', { red, extra });
    d = record(d, at('2026-11-30'), 'motor', null, null);
    const rows = dayRows(d);
    const code = encode(d.id, rows);
    expect(code.startsWith(PREFIX)).toBe(true);
    expect(code).toMatch(/^BRV1-[A-Za-z0-9_-]+$/);
    const back = decode(code)!;
    expect(back.id).toBe(0xbeef);
    expect(back.rows).toEqual(rows);
    expect(back.rows[0]).toEqual({ day: '2026-11-26', n: 2, flags: FLAG.walk | FLAG.kota_bogor, red: 35, extra: 3 });
    expect(back.rows[3]).toEqual({ day: '2026-11-30', n: 1, flags: FLAG.motor, red: null, extra: null });
    expect(summarize(back.rows)).toMatchObject({ days: 4, lookups: 5, medianRed: 25, medianExtra: 1, first: '2026-11-26', last: '2026-11-30' });
  });

  it('the checksum rejects a changed, dropped or added character', () => {
    let d = emptyDiary(1234, true);
    d = record(d, at('2026-11-26'), 'walk', 'badung_denpasar', { red: 20, extra: 1 });
    const code = encode(d.id, dayRows(d));
    const body = code.slice(PREFIX.length);
    for (let i = 0; i < body.length; i++) {
      const ch = body[i] === 'A' ? 'B' : 'A';
      expect(decode(PREFIX + body.slice(0, i) + ch + body.slice(i + 1))).toBeNull();
    }
    expect(decode(code.slice(0, -1))).toBeNull();
    expect(decode(code + 'A')).toBeNull();
    expect(decode('BRV2-' + body)).toBeNull();
    expect(decode('bukan kode')).toBeNull();
  });

  it('one code holds at most the latest CODE_DAYS days', () => {
    let d = emptyDiary(5, true);
    for (let k = 0; k < CODE_DAYS + 4; k++) d = record(d, new Date(2026, 10, 1 + k, 7), 'walk', null, { red: k, extra: 0 });
    const back = decode(encode(d.id, dayRows(d)))!;
    expect(back.rows.length).toBe(CODE_DAYS);
    expect(back.rows.at(-1)!.day).toBe(localDay(new Date(2026, 10, CODE_DAYS + 4, 7)));
  });

  it('the tally counts gate G4 inside the trial window, a resent code once, and rejects broken codes', () => {
    const code = (id: number, days: string[], red: number, mode: 'walk' | 'motor' = 'walk') => {
      let d = emptyDiary(id, true);
      for (const day of days) d = record(d, at(day), mode, 'badung_denpasar', { red, extra: 2 });
      return encode(d.id, dayRows(d));
    };
    const five = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30', '2026-12-02'];
    const a1 = code(1, five.slice(0, 2), 30), a2 = code(1, five, 30); // the same student, early and final code
    const b = code(2, ['2026-11-20', ...five.slice(0, 4)], 10, 'motor'); // 4 days inside the window + 1 before
    const c = code(3, five, 50);
    const text = `nama,kode\nP1,${a1}\nP1,${a2}\nP2,${b}\nP3,${c}\nP4,${c.slice(0, -2)}xx\n`;
    const r = rekap(findCodes(text));
    expect(r.kode_terbaca).toBe(4);
    expect(r.kode_ditolak).toBe(1);
    expect(r.peserta).toBe(3);
    expect(r.hari_per_peserta).toEqual([5, 5, 4]);
    expect(r.peserta_min_5_hari).toBe(2);
    expect(r.median_pengurangan_asap_pct).toBe(30);
    expect(r.moda).toEqual({ jalan_kaki: 2, motor: 1 });
    expect(r.wilayah.badung_denpasar).toBe(3);
  });
});

describe('trial diary on the phone (F4-07)', () => {
  const mem = new Map<string, string>();
  const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const cards = [{ minutes: 20, km: '1,50', vsFastest: null }, { minutes: 23, km: '1,62', vsFastest: { extraMin: 3, exhDosePct: -31 } }];
  const from = { lat: -8.6705, lng: 115.2126 };

  it('stores nothing until turned on, counts a lookup once, keeps no coordinate', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    const st = await import('../src/lib/trial/storage');
    expect(st.noteRouteLookup(cards, 'walk', from, at('2026-11-26'))).toBe(false);
    expect(mem.size).toBe(0);
    st.setDiaryOn(true);
    expect(st.noteRouteLookup(cards, 'walk', from, at('2026-11-26'))).toBe(true);
    expect(st.noteRouteLookup(cards, 'walk', from, new Date(at('2026-11-26').getTime() + 30_000))).toBe(false); // same cards again
    expect(st.noteRouteLookup(cards, 'motor', from, new Date(at('2026-11-26').getTime() + 40_000))).toBe(true);
    const d = st.loadDiary();
    expect(d.days['2026-11-26']).toEqual({ n: 2, flags: FLAG.walk | FLAG.motor | FLAG.badung_denpasar, red: [31, 31], extra: [3, 3] });
    const raw = mem.get(st.KEY)!;
    expect(raw).not.toMatch(/8\.67|115\.2|lat|lng/);
    st.clearDiary();
    expect(mem.size).toBe(0);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('works without storage at all (private window): nothing recorded, nothing thrown', async () => {
    const st = await import('../src/lib/trial/storage');
    expect(st.loadDiary().on).toBe(false);
    expect(st.noteRouteLookup(cards, 'walk', from)).toBe(false);
  });
});

describe('teacher tally page rows (F4-09)', async () => {
  const { rekapRows, windowOf } = await import('../src/lib/trial/rekapView');
  it('shows gate G4 as passed only from 15 students with at least 5 days', () => {
    const base = rekap([]);
    const rows = rekapRows({ ...base, peserta: 16, peserta_min_5_hari: 15, hari_per_peserta: [7, 5], median_pengurangan_asap_pct: 31.5, median_tambahan_menit: 2.5, kode_terbaca: 16, kode_ditolak: 2 });
    const g4 = rows.find((r) => r.label.includes('G4'))!;
    expect(g4.value).toBe('15: lulus');
    expect(rows.find((r) => r.label.startsWith('Median pengurangan'))!.value).toBe('32%');
    expect(rows.find((r) => r.label.startsWith('Kode terbaca'))!.value).toMatch(/16 \(2 ditolak/);
    expect(rekapRows({ ...base, peserta_min_5_hari: 14 }).find((r) => r.label.includes('G4'))!.value).toBe('14: belum lulus');
    expect(rekapRows(base).find((r) => r.label.startsWith('Median pengurangan'))!.value).toBe('–');
  });
  it('accepts only an ordered date window', () => {
    expect(windowOf('2026-11-26', '2026-12-02')).toEqual(['2026-11-26', '2026-12-02']);
    expect(windowOf('2026-12-02', '2026-11-26')).toBeNull();
    expect(windowOf('', '2026-11-26')).toBeNull();
  });
});

describe('progress towards 5 days (F4-10)', async () => {
  const { trialProgress, TRIAL_WINDOW, TARGET_DAYS } = await import('../src/lib/trial/diary');
  const { TRIAL_DATES } = await import('../src/lib/ujiCoba');
  const row = (day: string) => ({ day, n: 1, flags: 1, red: 30, extra: 1 });
  it('counts only days inside the trial window, inclusive, towards the target', () => {
    const p = trialProgress([row('2026-11-25'), row('2026-11-26'), row('2026-11-30'), row('2026-12-02'), row('2026-12-03')]);
    expect(p).toEqual({ inside: 3, outside: 2, target: 5, reached: false, share: 0.6 });
    const full = trialProgress(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'].map(row));
    expect(full.reached).toBe(true);
    expect(full.share).toBe(1);
    expect(trialProgress([]).inside).toBe(0);
  });
  it('the window, the target and the dates shown to students agree', () => {
    expect(TRIAL_WINDOW).toEqual(['2026-11-26', '2026-12-02']);
    expect(TARGET_DAYS).toBe(5);
    expect(TRIAL_DATES).toBe('26 November–2 Desember 2026');
  });
});

describe('diary when the phone does not allow storage (F4-11)', () => {
  const setStore = (s: unknown) => { (globalThis as { localStorage?: unknown }).localStorage = s; };
  it('a storage that throws: the diary does not pretend to be on', async () => {
    const st = await import('../src/lib/trial/storage');
    setStore({ getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} });
    const r = st.setDiaryOn(true);
    expect(r.saved).toBe(false);
    expect(r.diary.on).toBe(false);
    expect(st.noteRouteLookup([{ minutes: 5, km: '0,40', vsFastest: null }], 'walk', null)).toBe(false);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  it('a storage that silently keeps nothing: also reported as not saved', async () => {
    const st = await import('../src/lib/trial/storage');
    setStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const r = st.setDiaryOn(true);
    expect(r).toMatchObject({ saved: false, diary: { on: false } });
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  it('a working storage: saved and on', async () => {
    const st = await import('../src/lib/trial/storage');
    const m = new Map<string, string>();
    setStore({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    expect(st.setDiaryOn(true)).toMatchObject({ saved: true, diary: { on: true } });
    expect(st.setDiaryOn(false)).toMatchObject({ saved: true, diary: { on: false } });
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
