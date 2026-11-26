import { describe, expect, it } from 'vitest';
import { pilihanPrakiraan } from '../src/lib/field/prakiraanPeta';

const e = (ahead: number, local_hour: number) => ({ ahead, local_hour, valid: '', key: `p${ahead}.bxf` });

describe('M-U08 jam prakiraan di peta aplikasi', () => {
  it('hanya jam yang dihitung pembangun, urut, label jam lokal', () => {
    const p = pilihanPrakiraan([e(11, 7), e(1, 21), e(2, 22), e(3, 23), e(17, 13)], 20);
    expect(p.map((x) => x.label)).toEqual(['+1 jam (21.00)', '+2 jam (22.00)', '+3 jam (23.00)', '07.00 besok', '13.00 besok']);
    expect(p.map((x) => x.ahead)).toEqual([1, 2, 3, 11, 17]);
  });
  it('pagi: 13.00 hari ini tanpa kata besok', () => {
    expect(pilihanPrakiraan([e(5, 13)], 8)).toEqual([{ ahead: 5, label: '13.00' }]);
  });
  it('tanpa berkas prakiraan: tidak ada pilihan', () => {
    expect(pilihanPrakiraan([], 8)).toEqual([]);
    expect(pilihanPrakiraan(undefined, 8)).toEqual([]);
  });
});
