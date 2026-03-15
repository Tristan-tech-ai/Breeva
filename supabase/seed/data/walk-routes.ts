import type { City } from './city-locations';

export interface WalkRoute {
  origin: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  distance: number; // meters
  aqiMin: number;
  aqiMax: number;
}

export const WALK_ROUTES: Record<City, WalkRoute[]> = {
  jakarta: [
    { origin: { address: 'Bundaran HI, Jakarta Pusat', lat: -6.1950, lng: 106.8230 }, destination: { address: 'Kota Tua, Jakarta Barat', lat: -6.1350, lng: 106.8133 }, distance: 8500, aqiMin: 150, aqiMax: 200 },
    { origin: { address: 'Monas, Gambir, Jakarta Pusat', lat: -6.1754, lng: 106.8272 }, destination: { address: 'Stasiun Gambir, Jakarta Pusat', lat: -6.1766, lng: 106.8318 }, distance: 2200, aqiMin: 120, aqiMax: 180 },
    { origin: { address: 'Jl. Sudirman, Jakarta', lat: -6.2263, lng: 106.8020 }, destination: { address: 'Senayan Park, Jakarta', lat: -6.2254, lng: 106.7964 }, distance: 3500, aqiMin: 100, aqiMax: 160 },
    { origin: { address: 'Kemang, Jakarta Selatan', lat: -6.2608, lng: 106.8142 }, destination: { address: 'Blok M, Jakarta Selatan', lat: -6.2441, lng: 106.7983 }, distance: 4200, aqiMin: 130, aqiMax: 170 },
    { origin: { address: 'Menteng, Jakarta Pusat', lat: -6.1913, lng: 106.8202 }, destination: { address: 'Cikini, Jakarta Pusat', lat: -6.1866, lng: 106.8389 }, distance: 1800, aqiMin: 110, aqiMax: 150 },
    { origin: { address: 'GBK Senayan', lat: -6.2186, lng: 106.8019 }, destination: { address: 'Senayan City', lat: -6.2272, lng: 106.7973 }, distance: 2000, aqiMin: 80, aqiMax: 130 },
    { origin: { address: 'Jl. Thamrin, Jakarta', lat: -6.1952, lng: 106.8230 }, destination: { address: 'Monas, Jakarta', lat: -6.1754, lng: 106.8272 }, distance: 3000, aqiMin: 140, aqiMax: 190 },
  ],
  bali: [
    { origin: { address: 'Ubud Center, Gianyar, Bali', lat: -8.5069, lng: 115.2625 }, destination: { address: 'Monkey Forest, Ubud', lat: -8.5189, lng: 115.2588 }, distance: 1500, aqiMin: 30, aqiMax: 60 },
    { origin: { address: 'Ubud Center, Gianyar, Bali', lat: -8.5069, lng: 115.2625 }, destination: { address: 'Tegallalang Rice Terraces', lat: -8.4266, lng: 115.2791 }, distance: 12400, aqiMin: 40, aqiMax: 70 },
    { origin: { address: 'Seminyak, Bali', lat: -8.6929, lng: 115.1595 }, destination: { address: 'Double Six Beach, Seminyak', lat: -8.6974, lng: 115.1558 }, distance: 2500, aqiMin: 35, aqiMax: 55 },
    { origin: { address: 'Canggu, Bali', lat: -8.6500, lng: 115.1363 }, destination: { address: 'Echo Beach, Canggu', lat: -8.6543, lng: 115.1198 }, distance: 3200, aqiMin: 30, aqiMax: 50 },
    { origin: { address: 'Sanur, Bali', lat: -8.6930, lng: 115.2630 }, destination: { address: 'Pantai Mertasari, Sanur', lat: -8.7024, lng: 115.2660 }, distance: 4000, aqiMin: 40, aqiMax: 65 },
    { origin: { address: 'Kuta, Bali', lat: -8.7220, lng: 115.1695 }, destination: { address: 'Waterbom Bali, Kuta', lat: -8.7254, lng: 115.1692 }, distance: 1800, aqiMin: 50, aqiMax: 80 },
  ],
  bandung: [
    { origin: { address: 'Jl. Braga, Bandung', lat: -6.9171, lng: 107.6095 }, destination: { address: 'Gedung Sate, Bandung', lat: -6.9025, lng: 107.6190 }, distance: 2800, aqiMin: 70, aqiMax: 120 },
    { origin: { address: 'Dago, Bandung', lat: -6.8849, lng: 107.6165 }, destination: { address: 'ITB, Bandung', lat: -6.8915, lng: 107.6107 }, distance: 1500, aqiMin: 60, aqiMax: 100 },
    { origin: { address: 'Trans Studio Bandung', lat: -6.9261, lng: 107.6345 }, destination: { address: 'Ciwalk, Bandung', lat: -6.8884, lng: 107.6045 }, distance: 3500, aqiMin: 80, aqiMax: 130 },
    { origin: { address: 'Setrasari, Bandung', lat: -6.8904, lng: 107.5832 }, destination: { address: 'PVJ Mall, Bandung', lat: -6.8862, lng: 107.5976 }, distance: 2200, aqiMin: 65, aqiMax: 110 },
  ],
  surabaya: [
    { origin: { address: 'Tunjungan Plaza, Surabaya', lat: -7.2614, lng: 112.7416 }, destination: { address: 'Jembatan Merah, Surabaya', lat: -7.2464, lng: 112.7382 }, distance: 3000, aqiMin: 90, aqiMax: 140 },
    { origin: { address: 'Jl. Darmo, Surabaya', lat: -7.2897, lng: 112.7369 }, destination: { address: 'Kebun Binatang Surabaya', lat: -7.2947, lng: 112.7367 }, distance: 2500, aqiMin: 80, aqiMax: 130 },
  ],
};

export const AQ_DESCRIPTIONS: Record<City, string[]> = {
  jakarta: [
    'Asap kendaraan cukup tebal di persimpangan jalan.',
    'Langit abu-abu, bau asap kendaraan menyengat.',
    'Traffic jam parah, polusi sangat terasa di Sudirman.',
    'Debu dan asap terlihat jelas di sekitar jalan utama.',
    'Polusi terasa lebih ringan pagi ini, angin cukup kencang.',
    'Area ini relatif bersih karena dekat taman kota.',
  ],
  bali: [
    'Udara segar, angin laut sepoi-sepoi.',
    'Pagi cerah di Ubud, sangat nyaman untuk jalan.',
    'Sedikit asap dari pembakaran sampah di kejauhan.',
    'Area pantai sangat bersih, udara sejuk.',
    'Langit biru, visibility sangat baik.',
  ],
  bandung: [
    'Pagi cerah, udara bersih di daerah Dago Atas.',
    'Agak berdebu di jalan utama, tapi masih oke.',
    'Polusi ringan dari kendaraan, udara sedikit pengap.',
    'Area kampus ITB cukup rindang dan segar.',
  ],
  surabaya: [
    'Polusi terasa, visibility menurun di jalan raya.',
    'Area pelabuhan agak berdebu tapi angin laut menyegarkan.',
    'Pagi ini cukup cerah, udara lumayan bersih.',
  ],
};
