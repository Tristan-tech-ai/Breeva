import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simulasiLine, type SimulasiFile } from '../src/lib/simulasi';

describe('closure simulation files shown on /prioritas', () => {
  for (const name of ['badung_denpasar', 'kota_bogor']) {
    it(`${name}: every school of the priority list has a sentence, and the reference conditions are stated`, () => {
      const sim = JSON.parse(readFileSync(`public/data/simulasi/${name}.json`, 'utf8')) as SimulasiFile;
      const list = JSON.parse(readFileSync(`public/data/prioritas/${name}.json`, 'utf8')) as { fasilitas: Array<{ id: string; kelas: string }> };
      const schools = list.fasilitas.filter((f) => f.kelas === 'pendidikan').map((f) => f.id);
      expect(sim.sekolah.map((s) => s.id).sort()).toEqual([...schools].sort());
      expect(sim.kondisi.jam_lokal).toBe(7);
      expect(sim.kondisi.catatan).toMatch(/antar-jemput/);
      for (const s of sim.sekolah) {
        expect(simulasiLine(s).length).toBeGreaterThan(20);
        // a detour that passes another side of the school (a corner school) can raise the gate value: the text must say so
        if (s.status === 'ok' && s.perubahan_persen! > 0) expect(s.teks).toMatch(/naik/);
        if (s.status === 'ok' && s.perubahan_persen! < 0) expect(s.teks).toMatch(/turun/);
      }
    });
  }
});
