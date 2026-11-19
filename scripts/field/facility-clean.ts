/**
 * Cleaning of the priority list's facility table (tasks X-W88 and X-W90, 20 Nov 2026).
 *
 * OpenStreetMap tags some places as amenity=school that are not schools children attend all day: tutoring centres
 * (bimbel), language and music courses, training institutes and academies for adults. They are dropped from the
 * education ranking, each with its reason, unless the name also carries a formal school level (SD, SMP, SMK, TK, ...),
 * as in "SMK/SMA Pembangunan & Akademi Akuntansi". A school's gate mapped as its own point ("Gerbang Masuk/Keluar -
 * MAN 2 Kota Bogor") and the same school mapped several times (one point per building) are merged into one facility
 * that keeps the most exposed point, since that is where the children pass.
 */

/** A formal school level in the name keeps the facility whatever else the name says. */
const LEVEL = /\b(sd|sdn|sdi|sdit|smp|smpn|smpit|smps|sma|sman|smait|smk|smkn|mi|min|mts|mtsn|ma|man|tk|tkit|paud|kb|slb|sekolah dasar|sekolah menengah|taman kanak|playgroup|kindergarten|preschool|pre-school|primary school|elementary|junior high|senior high|high school|boarding school)\b/i;

/** Course and adult-education names; each pattern carries the reason written into the list. */
export const COURSE_RULES: Array<{ re: RegExp; alasan: string }> = [
  { re: /\b(primagama|neutron|ganesha operation|sony sugema|kumon|sakamoto|eye level|bimbel|bimbingan belajar|les privat|private tutor|tutoring)\b/i, alasan: 'bimbingan belajar' },
  { re: /\b(kursus|lembaga kursus|course)\b/i, alasan: 'kursus' },
  { re: /\b(english first|wall street english|language (learning )?(school|cent(er|re))|pusat bahasa|lembaga bahasa)\b/i, alasan: 'kursus bahasa' },
  { re: /\b(music school|sekolah musik|yamaha music|purwacaraka|studio|dance school|sekolah tari)\b/i, alasan: 'kursus musik atau tari' },
  { re: /\b(pelatihan|training cent(er|re)|lpk|lembaga pendidikan pariwisata)\b/i, alasan: 'lembaga pelatihan' },
  { re: /\b(akademi|academy|politeknik|universitas|university|institut|sekolah tinggi|college)\b/i, alasan: 'pendidikan tinggi' },
];

const EDUCATION = new Set(['school', 'kindergarten', 'childcare']);
const SCHOOL_WORD = /\bschool\b/i;

/** Why a facility is not a school children attend, or null when it stays in the list. */
export function courseReason(nama: string | null | undefined, jenis: string): string | null {
  if (!EDUCATION.has(jenis)) return null;
  const n = (nama ?? '').trim();
  if (!n || LEVEL.test(n)) return null;
  for (const r of COURSE_RULES) {
    // "Saraswati School & University": a school campus that also holds a university stays
    if (r.re.test(n) && !(r.alasan === 'pendidikan tinggi' && SCHOOL_WORD.test(n))) return r.alasan;
  }
  return null;
}

const GATE = /\b(gerbang( (masuk|keluar|utama|depan|belakang))?(\s*(\/|dan|&)\s*(masuk|keluar))?|pintu (masuk|keluar|utama|gerbang)(\s*(\/|dan|&)\s*(masuk|keluar))?|main gate|gate|entrance)\b/i;

/** For a gate's own point, the facility name without the gate words; null when the name is not a gate. */
export function gateBase(nama: string | null | undefined): string | null {
  const n = (nama ?? '').trim();
  if (!GATE.test(n)) return null;
  const parts = n.split(/\s+[-–]\s+/);
  const kept = parts.length > 1 ? parts.filter((p) => !GATE.test(p)) : [n.replace(GATE, ' ')];
  const base = kept.join(' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  return base.length >= 3 ? base : null;
}

const tokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/** True when the shorter name's words appear, in order and contiguously, in the longer one ("MAN 1" in "MAN 1 Kota Bogor"). */
export function sameFacilityName(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!s.length) return false;
  for (let i = 0; i + s.length <= l.length; i++) if (s.every((t, j) => l[i + j] === t)) return true;
  return false;
}

const M_LAT = 110574;
export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return Math.hypot((a.lat - b.lat) * M_LAT, (a.lon - b.lon) * M_LAT * Math.cos((a.lat * Math.PI) / 180));
}

export interface Ranked { id: string; nama: string; kelas: string; jenis: string; lat: number; lon: number; no2_lalin: number; pm25_lalin: number }
export interface Merge { tetap: string; nama: string; digabung: Array<{ id: string; nama: string; alasan: 'gerbang' | 'nama sama' }> }

/**
 * Merge gates into their facility and repeated points of one facility (same name within `maxM` metres, same class).
 * The kept entry takes the exposure values of the most exposed point of its group (with that point's coordinates) and,
 * for a gate whose facility is not on the list, the facility's name. Returns the cleaned items and the merge record.
 */
export function mergeFacilities<T extends Ranked>(items: T[], maxM = 300): { items: T[]; merges: Merge[] } {
  const base = items.map((it) => gateBase(it.nama));
  const nameOf = (k: number) => base[k] ?? items[k].nama ?? '';
  // unnamed points ("(school tanpa nama)") are never merged by name
  const key = items.map((it, k) => (/^\(.*tanpa nama\)$/.test((it.nama ?? '').trim()) ? '' : tokens(nameOf(k)).join(' ')));
  const parent = items.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (items[a].kelas !== items[b].kelas || !key[a] || !key[b]) continue;
      if (Math.abs(items[a].lat - items[b].lat) * M_LAT > maxM) continue;
      const gate = base[a] != null || base[b] != null;
      const match = gate ? sameFacilityName(nameOf(a), nameOf(b)) : key[a] === key[b];
      if (!match || metres(items[a], items[b]) > maxM) continue;
      parent[find(b)] = find(a);
    }
  }
  const groups = new Map<number, number[]>();
  items.forEach((_, k) => { const r = find(k); groups.set(r, [...(groups.get(r) ?? []), k]); });
  const keep = new Set<number>();
  const merges: Merge[] = [];
  const out: T[] = [];
  for (const ks of groups.values()) {
    // the entry that names the facility (not a gate), else the first; values from the most exposed point
    const names = ks.filter((k) => base[k] == null).sort((x, y) => (items[y].nama ?? '').length - (items[x].nama ?? '').length);
    const named = names[0] ?? ks[0]; // the fullest facility name ("SMP Negeri 6 Kota Bogor" over "SMP Negeri 6")
    const hot = ks.reduce((m, k) => (items[k].no2_lalin > items[m].no2_lalin || (items[k].no2_lalin === items[m].no2_lalin && items[k].pm25_lalin > items[m].pm25_lalin) ? k : m), ks[0]);
    const nama = base[named] ?? items[named].nama;
    out.push({ ...items[hot], id: items[named].id, nama });
    keep.add(named);
    if (ks.length > 1) {
      merges.push({
        tetap: items[named].id, nama,
        digabung: ks.filter((k) => k !== named).map((k) => ({ id: items[k].id, nama: items[k].nama, alasan: base[k] != null ? 'gerbang' : 'nama sama' })),
      });
    }
  }
  return { items: out, merges };
}
