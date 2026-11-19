import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode, encode, FLAG } from '../src/lib/trial/diary';
import { PRIVACY } from '../src/lib/ujiCoba';

// What the summary code carries, and the words every privacy line must use for it (X-W134, 20 Nov: the guide, the diary
// card and the consent sheet said "date, mode and route numbers" while the code also holds the number of route lookups,
// the region and a random phone number).
const WORDS: Record<string, RegExp> = {
  id: /nomor acak ponsel/,
  day: /tanggal/,
  n: /berapa rute yang\s+dilihat/,
  flags: /moda[\s\S]*wilayah|wilayah[\s\S]*moda/,
  red: /angka perbandingan rute/,
  extra: /angka perbandingan rute/,
};

const flat = (s: string) => s.replace(/\s+/g, ' ');
const card = flat(readFileSync('src/components/features/TrialDiaryCard.tsx', 'utf8'));
const rekap = flat(readFileSync('src/pages/UjiCobaRekapPage.tsx', 'utf8'));

describe('privacy lines name every field of the summary code', () => {
  const code = encode(4242, [{ day: '2026-11-26', n: 2, flags: FLAG.walk | FLAG.motor | FLAG.badung_denpasar, red: 26, extra: 0 }]);
  const back = decode(code)!;
  const fields = ['id', ...Object.keys(back.rows[0])];

  it('the code holds exactly the fields listed here, and no coordinate', () => {
    expect(fields.sort()).toEqual(Object.keys(WORDS).sort());
    expect(JSON.stringify(back)).not.toMatch(/lat|lng|lon|-8\.6|115\./);
  });

  it.each([['the guide (PRIVACY)', flat(PRIVACY)], ['the diary card', card], ['the teacher tally page', rekap]])('%s names them', (_, text) => {
    for (const f of fields) expect(text, f).toMatch(WORDS[f]);
  });

  it('fails when a line drops a field', () => {
    const old = 'catatan uji coba hanya menyimpan tanggal, moda, dan angka perbandingan rute';
    expect(fields.every((f) => WORDS[f].test(old))).toBe(false);
  });
});
