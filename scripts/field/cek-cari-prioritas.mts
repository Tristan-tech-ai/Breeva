/**
 * X-W72: can every school and health facility of the /prioritas lists be found by name with the offline search?
 * For each facility, searchPoiPack(pack of its region, name, near its point); found when a result has the same
 * normalised name within 300 m. Per region and class, the share found.
 *   npx tsx scripts/field/cek-cari-prioritas.mts <poi_pack_dir> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePoiPack, normName, searchPoiPack, type PoiPackFile, type POI } from '../../src/lib/poiPack.js';

interface Facility { id: string; nama?: string | null; kelas: string; jenis: string; lat: number; lon: number }

const [packDir, out] = process.argv.slice(2);
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dy = (a.lat - b.lat) * 111_320;
  const dx = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

export function foundByName(pois: POI[], f: Facility): boolean {
  if (!f.nama) return false;
  const near = { lat: f.lat, lng: f.lon };
  const want = normName(f.nama);
  return searchPoiPack(pois, f.nama, near, 8).some((p) => normName(p.name) === want && metres(p.coordinate, near) <= 300);
}

// run only as a script (the test imports foundByName)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && packDir && out) {
  const result: Record<string, unknown> = {};
  for (const region of ['kota_bogor', 'badung_denpasar']) {
    const pack = JSON.parse(readFileSync(join(packDir, `${region}.json`), 'utf8')) as PoiPackFile;
    const pois = decodePoiPack(pack);
    const list = (JSON.parse(readFileSync(`public/data/prioritas/${region}.json`, 'utf8')) as { fasilitas: Facility[] }).fasilitas;
    const byClass: Record<string, { n: number; ketemu: number; tanpa_nama: number; contoh_tidak: string[] }> = {};
    for (const f of list) {
      const c = (byClass[f.kelas] ??= { n: 0, ketemu: 0, tanpa_nama: 0, contoh_tidak: [] });
      c.n++;
      if (!f.nama) { c.tanpa_nama++; continue; }
      if (foundByName(pois, f)) c.ketemu++;
      else if (c.contoh_tidak.length < 12) c.contoh_tidak.push(f.nama);
    }
    const named = list.filter((f) => f.nama).length;
    const ketemu = Object.values(byClass).reduce((a, c) => a + c.ketemu, 0);
    result[region] = { rilis_paket: pack.release, fasilitas: list.length, bernama: named, ketemu, persen_dari_bernama: Math.round((1000 * ketemu) / named) / 10, per_kelas: byClass };
  }
  writeFileSync(out, JSON.stringify({ tugas: 'X-W72 fasilitas prioritas bisa dicari luring', cara: 'searchPoiPack(nama, dekat titik fasilitas, 8 hasil); ketemu = nama ternormalisasi sama dan <= 300 m', hasil: result }, null, 1));
  console.log(JSON.stringify(result, (k, v) => (k === 'contoh_tidak' ? (v as string[]).slice(0, 4) : v)));
}
