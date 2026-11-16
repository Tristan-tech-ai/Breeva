/**
 * "Ke sekolah" picker (task F1-12): the named schools of a region from its BSZ1 v2 file, searched by name on the
 * device. Common abbreviations are expanded both ways, so "sman 1" finds "SMA Negeri 1" and the other way round.
 */
import type { SchoolFile } from './schoolZone';

export interface SchoolEntry { k: number; name: string; lat: number; lng: number; kind: 'school' | 'kindergarten'; key: string }

const ABBR: Array<[RegExp, string]> = [
  [/\bsman\b/g, 'sma negeri'], [/\bsmkn\b/g, 'smk negeri'], [/\bsmpn\b/g, 'smp negeri'], [/\bsdn\b/g, 'sd negeri'],
  [/\bsmas\b/g, 'sma swasta'], [/\bmts n\b/g, 'mts negeri'], [/\bman\b/g, 'ma negeri'], [/\bn\b/g, 'negeri'],
];

/** Lower case, accents and punctuation removed, abbreviations expanded, single spaces. */
export function normalizeName(s: string): string {
  let t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [re, to] of ABBR) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ');
}

/** Named schools, one per normalised name and place (the same school mapped twice within about 100 m is listed once). */
export function schoolList(f: Pick<SchoolFile, 'points' | 'names' | 'kinds'>): SchoolEntry[] {
  const out: SchoolEntry[] = [];
  const seen = new Set<string>();
  (f.names ?? []).forEach((name, k) => {
    if (!name) return;
    const [lat, lng] = f.points[k];
    const key = normalizeName(name);
    const dup = `${key}@${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (seen.has(dup)) return;
    seen.add(dup);
    out.push({ k, name, lat, lng, kind: f.kinds?.[k] ?? 'school', key });
  });
  return out;
}

/**
 * Schools whose name holds every word of the query (after normalising both), best first: a name that starts with the
 * query, then names where the words appear in order, then shorter names.
 */
export function searchSchools(list: SchoolEntry[], query: string, limit = 8): SchoolEntry[] {
  const q = normalizeName(query);
  if (!q) return [];
  const words = q.split(' ');
  const score = (e: SchoolEntry) => (e.key.startsWith(q) ? 0 : e.key.includes(q) ? 1 : 2) * 1000 + e.key.length;
  return list
    .filter((e) => words.every((w) => e.key.split(' ').some((t) => t.startsWith(w)) || (/^\d+$/.test(w) && e.key.includes(w))))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
