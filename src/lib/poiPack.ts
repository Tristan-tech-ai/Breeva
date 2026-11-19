/**
 * POI packs (F1-69): every named place of a field region from Overture Maps places and OpenStreetMap, built by
 * scripts/field/build_poi_pack.py and served from the field CDN (tiles/poi/<release>/<region>.json, brotli). Inside a
 * region the map's POI layer reads the pack instead of the Geoapify proxy, which returned at most 100 places per view and
 * left the map incomplete (Tristan, 18 Nov 2026); the pack is also saved with the region for offline use.
 */
import type { POI } from './poi-api';
import { ROUTE_CACHE, cachedBytes } from './route/assets';

export const POI_RELEASE = '2026-10-21.0';
export const POI_ATTRIBUTION = 'Tempat: <a href="https://overturemaps.org">Overture Maps</a> (Meta, Microsoft, Foursquare, AllThePlaces dkk.) dan &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** One pack as stored: [name, category index, lat*1e5, lng*1e5, address]. */
export interface PoiPackFile { format: 'breeva_poi'; v: 1; region: string; release: string; cats: string[]; pois: Array<[string, number, number, number, string]> }

export function poiPackUrl(base: string, region: string): string {
  return `${base}/tiles/poi/${POI_RELEASE}/${region}.json`;
}

/** The pack as POI objects (types: the category and its parents, as the Geoapify results carried them). */
export function decodePoiPack(f: PoiPackFile): POI[] {
  if (f.format !== 'breeva_poi' || f.v !== 1) throw new Error('bukan paket POI Breeva v1');
  const types = f.cats.map((c) => c.split('.').map((_, i, a) => a.slice(0, a.length - i).join('.')));
  return f.pois.map(([name, ci, lat, lng, addr], i) => {
    const cat = f.cats[ci];
    return {
      id: `poi-${f.region}-${i}`,
      name,
      category: cat.split('.')[0],
      subcategory: cat.split('.').slice(0, 2).join('.'),
      coordinate: { lat: lat / 1e5, lng: lng / 1e5 },
      address: addr || undefined,
      types: types[ci],
    };
  });
}

/** POIs inside the box; with categories (Geoapify-style paths, comma lists allowed) only those or their children. */
export function poisInRect(pois: POI[], b: { south: number; west: number; north: number; east: number }, categories?: string): POI[] {
  const wanted = (categories ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  return pois.filter((p) => p.coordinate.lat >= b.south && p.coordinate.lat <= b.north && p.coordinate.lng >= b.west && p.coordinate.lng <= b.east
    && (!wanted.length || (p.types ?? []).some((t) => wanted.some((w) => t === w || t.startsWith(w + '.')))));
}

// Indonesian names of the pack categories, for search results and place cards (most specific first)
const LABELS: Array<[string, string]> = [
  ['catering.fast_food', 'Makanan cepat saji'], ['catering.cafe', 'Kafe'], ['catering.bar', 'Bar'], ['catering', 'Rumah makan'],
  ['accommodation.hotel', 'Hotel'], ['accommodation', 'Penginapan'],
  ['commercial.supermarket', 'Swalayan'], ['commercial.convenience', 'Minimarket'], ['commercial.shopping_mall', 'Mal'],
  ['commercial.department_store', 'Toserba'], ['commercial.marketplace', 'Pasar'], ['commercial.clothing', 'Toko pakaian'],
  ['commercial.electronics', 'Toko elektronik'], ['commercial.food_and_drink', 'Toko makanan'], ['commercial', 'Toko'],
  ['religion.place_of_worship.islam', 'Masjid atau musala'], ['religion.place_of_worship.hinduism', 'Pura'],
  ['religion.place_of_worship.christianity', 'Gereja'], ['religion.place_of_worship.buddhism', 'Vihara atau klenteng'], ['religion', 'Tempat ibadah'],
  ['service.financial.atm', 'ATM'], ['service.financial.bank', 'Bank'], ['service.vehicle.fuel', 'SPBU'], ['service.police', 'Polisi'],
  ['education.kindergarten', 'TK atau PAUD'], ['education.university', 'Kampus'], ['education.college', 'Kampus'],
  ['education.library', 'Perpustakaan'], ['education', 'Sekolah'],
  ['healthcare.hospital', 'Rumah sakit'], ['healthcare.pharmacy', 'Apotek'], ['healthcare.dentist', 'Dokter gigi'], ['healthcare', 'Klinik'],
  ['leisure.playground', 'Taman bermain'], ['leisure.fitness', 'Pusat kebugaran'], ['leisure.swimming', 'Kolam renang'],
  ['leisure.sport', 'Tempat olahraga'], ['leisure', 'Taman'],
  ['entertainment.museum', 'Museum'], ['entertainment.cinema', 'Bioskop'], ['entertainment', 'Hiburan'],
  ['tourism.sights', 'Situs bersejarah'], ['tourism', 'Tempat wisata'], ['public_transport', 'Halte atau terminal'],
];

/** Indonesian label of a category path ("catering.cafe" -> "Kafe"); "Tempat" when unknown. */
export function poiCategoryLabel(cat: string | undefined): string {
  if (!cat) return 'Tempat';
  const hit = LABELS.find(([k]) => cat === k || cat.startsWith(k + '.'));
  return hit ? hit[1] : 'Tempat';
}

/** Lowercase, without accents and punctuation, single spaces ("Kopi TUKU - Pajajaran" -> "kopi tuku pajajaran"). */
export function normName(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Places of a pack whose name matches the query (F1-71): the whole name starting with it first, then a word starting
 * with it, then the text anywhere, then the text without spaces; within a rank the nearest to `near` first. Works without internet once the pack is
 * saved with the region.
 */
export function searchPoiPack(pois: POI[], query: string, near?: { lat: number; lng: number }, max = 8): POI[] {
  const q = normName(query);
  if (q.length < 2) return [];
  const qc = q.replace(/ /g, '');
  const scored: Array<{ p: POI; rank: number; d: number }> = [];
  for (const p of pois) {
    const n = normName(p.name);
    const nc = n.replace(/ /g, '');
    // spaces differ between sources ("Swiss-Belhotel" and "Swissbel Hotel"): compare without spaces as well
    const rank = n.startsWith(q) || nc.startsWith(qc) ? 0 : (' ' + n).includes(' ' + q) ? 1 : n.includes(q) ? 2 : nc.includes(qc) ? 3 : -1;
    if (rank < 0) continue;
    const d = near ? (p.coordinate.lat - near.lat) ** 2 + ((p.coordinate.lng - near.lng) * Math.cos((near.lat * Math.PI) / 180)) ** 2 : 0;
    scored.push({ p, rank, d });
  }
  scored.sort((a, b) => a.rank - b.rank || a.d - b.d || a.p.name.length - b.p.name.length);
  // one result per place: the same name within about 300 m is the same place mapped twice (two sources or two features)
  const out: POI[] = [];
  for (const { p } of scored) {
    if (out.length >= max) break;
    const n = normName(p.name);
    if (out.some((o) => normName(o.name) === n && Math.abs(o.coordinate.lat - p.coordinate.lat) < 0.003 && Math.abs(o.coordinate.lng - p.coordinate.lng) < 0.003)) continue;
    out.push(p);
  }
  return out;
}

const loaded = new Map<string, Promise<POI[]>>();

/** The decoded pack of a region, once per page (cache first, so a saved region works offline). */
export function loadPoiPack(base: string, region: string, fetchBytes: typeof cachedBytes = cachedBytes): Promise<POI[]> {
  const url = poiPackUrl(base, region);
  let p = loaded.get(url);
  if (!p) {
    p = fetchBytes(url, { cacheFirst: true }).then((b) => decodePoiPack(JSON.parse(new TextDecoder().decode(b)) as PoiPackFile));
    p.catch(() => loaded.delete(url)); // a failed load may be tried again later
    loaded.set(url, p);
  }
  return p;
}

export { ROUTE_CACHE as POI_CACHE };
