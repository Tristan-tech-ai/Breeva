const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-09-01" -> "1 Sep 2026"; "2026-11-25 20:18" -> "25 Nov 2026 20.18"; anything else is returned unchanged. */
export function tanggalId(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return s;
  const bulan = BULAN[Number(m[2]) - 1];
  if (!bulan) return s;
  const hari = `${Number(m[3])} ${bulan} ${m[1]}`;
  return m[4] ? `${hari} ${m[4]}.${m[5]}` : hari;
}
