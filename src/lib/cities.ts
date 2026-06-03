// Canonical city list for the PUBLIC, crawlable air-quality pages (/udara/:slug).
// Coordinates are a representative city-center within each region recognized by
// api/vayu/aqi.ts `detectRegion()`. Keep this list in sync with the CITIES array
// in prerender-routes.mjs (the build script can't import TS, so it duplicates these
// 8 entries — they change rarely).

export interface CityAir {
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  blurb: string;
}

export const CITIES: CityAir[] = [
  { slug: 'jakarta',    name: 'Jakarta',    region: 'DKI Jakarta',           lat: -6.2088, lng: 106.8456, blurb: 'Ibu kota dengan lalu lintas padat — Breeva memetakan AQI per ruas jalan agar kamu bisa memilih jalur paling bersih.' },
  { slug: 'bandung',    name: 'Bandung',    region: 'Jawa Barat',            lat: -6.9175, lng: 107.6191, blurb: 'Cekungan Bandung membuat polusi mudah terperangkap; lihat kualitas udara per jalan dan rute teduh.' },
  { slug: 'surabaya',   name: 'Surabaya',   region: 'Jawa Timur',            lat: -7.2575, lng: 112.7521, blurb: 'Kota industri & pelabuhan — pantau PM2.5 dan NO₂ per ruas jalan secara real-time.' },
  { slug: 'bali',       name: 'Bali',       region: 'Bali (Denpasar–Badung)', lat: -8.6705, lng: 115.2126, blurb: 'Dari Denpasar hingga Canggu — udara relatif bersih, tapi jalan ramai tetap punya hotspot polusi.' },
  { slug: 'semarang',   name: 'Semarang',   region: 'Jawa Tengah',           lat: -6.9932, lng: 110.4203, blurb: 'Pesisir utara Jawa — cek AQI per jalan sebelum berjalan kaki atau bersepeda.' },
  { slug: 'yogyakarta', name: 'Yogyakarta', region: 'DI Yogyakarta',         lat: -7.7956, lng: 110.3695, blurb: 'Kota pelajar & wisata — temukan rute jalan kaki paling bersih di sekitar Malioboro dan kampus.' },
  { slug: 'solo',       name: 'Solo',       region: 'Jawa Tengah (Surakarta)', lat: -7.5755, lng: 110.8243, blurb: 'Surakarta — pantau kualitas udara per ruas jalan dan paparan PM2.5 harianmu.' },
  { slug: 'malang',     name: 'Malang',     region: 'Jawa Timur',            lat: -7.9839, lng: 112.6214, blurb: 'Kota sejuk di kaki gunung — bandingkan udara antar jalan dan pilih jalur tersehat.' },
];

export const CITY_BY_SLUG: Record<string, CityAir> = Object.fromEntries(CITIES.map((c) => [c.slug, c]));
