import { beforeEach, describe, expect, it } from 'vitest';
import { _kosongkanPenjaga, adaYangMenahan, bolehMuatUlang, daftarPenjaga } from '../src/lib/penjaga-muat';

describe('penjaga muat ulang', () => {
  beforeEach(() => _kosongkanPenjaga());

  it('tanpa penjaga tidak ada yang menahan', () => {
    expect(adaYangMenahan()).toBe(false);
  });
  it('jalan aktif atau rute dihitung menahan', () => {
    let jalan = false;
    let rute = false;
    daftarPenjaga(() => jalan);
    daftarPenjaga(() => rute);
    expect(adaYangMenahan()).toBe(false);
    jalan = true;
    expect(adaYangMenahan()).toBe(true);
    jalan = false; rute = true;
    expect(adaYangMenahan()).toBe(true);
  });
  it('penjaga yang galat tidak menahan', () => {
    daftarPenjaga(() => { throw new Error('x'); });
    expect(adaYangMenahan()).toBe(false);
  });
  it('tidak memuat ulang dua kali dalam 30 detik, dan tidak saat ditahan', () => {
    expect(bolehMuatUlang({ menahan: false, terakhirMuatUlang: 0, sekarang: 1_000_000 })).toBe(true);
    expect(bolehMuatUlang({ menahan: false, terakhirMuatUlang: 990_000, sekarang: 1_000_000 })).toBe(false);
    expect(bolehMuatUlang({ menahan: true, terakhirMuatUlang: 0, sekarang: 1_000_000 })).toBe(false);
  });
});
