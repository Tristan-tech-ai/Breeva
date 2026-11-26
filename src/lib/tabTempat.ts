/**
 * M-U10: the tabs of the place sheet. With the static field the places come from Overture and OpenStreetMap only (decision
 * 18 Nov 2026: no Google Places), so there are no reviews or photos to show: those tabs are left out instead of showing a
 * grey skeleton that never fills.
 */
export type TabTempat = 'overview' | 'reviews' | 'photos' | 'about';

export function tabTempat(sumberGoogle: boolean): { key: TabTempat; label: string }[] {
  const semua: { key: TabTempat; label: string }[] = [
    { key: 'overview', label: 'Ringkasan' },
    { key: 'reviews', label: 'Ulasan' },
    { key: 'photos', label: 'Foto' },
    { key: 'about', label: 'Tentang' },
  ];
  return sumberGoogle ? semua : semua.filter((t) => t.key === 'overview' || t.key === 'about');
}
