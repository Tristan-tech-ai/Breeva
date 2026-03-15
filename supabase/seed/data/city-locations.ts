export interface LocationEntry {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export const JAKARTA_LOCATIONS: LocationEntry[] = [
  { name: 'Kemang', address: 'Jl. Kemang Raya No. 12, Jakarta Selatan', lat: -6.2608, lng: 106.8142 },
  { name: 'Senayan', address: 'Jl. Asia Afrika, Senayan, Jakarta Pusat', lat: -6.2254, lng: 106.7964 },
  { name: 'Menteng', address: 'Jl. Menteng Raya No. 45, Jakarta Pusat', lat: -6.1913, lng: 106.8202 },
  { name: 'Kota Tua', address: 'Jl. Kali Besar Barat, Kota Tua, Jakarta Barat', lat: -6.1350, lng: 106.8133 },
  { name: 'Sudirman', address: 'Jl. Jend. Sudirman Kav. 52-53, Jakarta Selatan', lat: -6.2263, lng: 106.8020 },
  { name: 'Blok M', address: 'Jl. Melawai Raya, Blok M, Jakarta Selatan', lat: -6.2441, lng: 106.7983 },
  { name: 'Monas', address: 'Monumen Nasional, Gambir, Jakarta Pusat', lat: -6.1754, lng: 106.8272 },
  { name: 'Thamrin', address: 'Jl. M.H. Thamrin, Jakarta Pusat', lat: -6.1952, lng: 106.8230 },
  { name: 'Bundaran HI', address: 'Bundaran Hotel Indonesia, Jakarta Pusat', lat: -6.1950, lng: 106.8230 },
  { name: 'Cikini', address: 'Jl. Cikini Raya, Menteng, Jakarta Pusat', lat: -6.1866, lng: 106.8389 },
  { name: 'GBK Senayan', address: 'Gelora Bung Karno, Senayan', lat: -6.2186, lng: 106.8019 },
  { name: 'PIK', address: 'Pantai Indah Kapuk, Jakarta Utara', lat: -6.1106, lng: 106.7404 },
];

export const BALI_LOCATIONS: LocationEntry[] = [
  { name: 'Ubud Center', address: 'Jl. Raya Ubud, Gianyar, Bali', lat: -8.5069, lng: 115.2625 },
  { name: 'Seminyak', address: 'Jl. Kayu Aya, Seminyak, Bali', lat: -8.6929, lng: 115.1595 },
  { name: 'Canggu', address: 'Jl. Pantai Batu Bolong, Canggu, Bali', lat: -8.6500, lng: 115.1363 },
  { name: 'Sanur', address: 'Jl. Danau Tamblingan, Sanur, Bali', lat: -8.6930, lng: 115.2630 },
  { name: 'Kuta', address: 'Jl. Legian, Kuta, Bali', lat: -8.7220, lng: 115.1695 },
  { name: 'Tegallalang', address: 'Tegallalang Rice Terrace, Gianyar, Bali', lat: -8.4266, lng: 115.2791 },
  { name: 'Monkey Forest', address: 'Monkey Forest Ubud, Gianyar, Bali', lat: -8.5189, lng: 115.2588 },
  { name: 'Tanah Lot', address: 'Tanah Lot, Tabanan, Bali', lat: -8.6213, lng: 115.0868 },
];

export const BANDUNG_LOCATIONS: LocationEntry[] = [
  { name: 'Dago', address: 'Jl. Ir. H. Juanda (Dago), Bandung', lat: -6.8849, lng: 107.6165 },
  { name: 'Braga', address: 'Jl. Braga, Bandung', lat: -6.9171, lng: 107.6095 },
  { name: 'Setrasari', address: 'Jl. Setrasari, Bandung', lat: -6.8904, lng: 107.5832 },
  { name: 'Gedung Sate', address: 'Jl. Diponegoro, Bandung', lat: -6.9025, lng: 107.6190 },
  { name: 'Ciumbuleuit', address: 'Jl. Ciumbuleuit, Bandung', lat: -6.8663, lng: 107.6072 },
];

export const SURABAYA_LOCATIONS: LocationEntry[] = [
  { name: 'Tunjungan', address: 'Jl. Tunjungan, Surabaya', lat: -7.2614, lng: 112.7416 },
  { name: 'Darmo', address: 'Jl. Raya Darmo, Surabaya', lat: -7.2897, lng: 112.7369 },
  { name: 'Gubeng', address: 'Jl. Raya Gubeng, Surabaya', lat: -7.2717, lng: 112.7520 },
];

export type City = 'jakarta' | 'bali' | 'bandung' | 'surabaya';

export const CITY_LOCATIONS: Record<City, LocationEntry[]> = {
  jakarta: JAKARTA_LOCATIONS,
  bali: BALI_LOCATIONS,
  bandung: BANDUNG_LOCATIONS,
  surabaya: SURABAYA_LOCATIONS,
};
