# Sumber data, lisensi, dan atribusi

Daftar ini mencakup setiap sumber data dan layanan pihak lain yang dipakai Breeva, beserta syarat pemakaiannya. Syarat dicek
pada **16 November 2026**. Tanda di kolom terakhir: **dibuka** = halaman resmi dibaca langsung; **pencarian** = syarat diambil
dari hasil pencarian yang menunjuk halaman resmi, halamannya sendiri belum dibuka; **belum** = belum dicek.

## Ringkasan aturan

1. **Pembacaan mentah IQAir dan WAQI tidak dipublikasikan ulang**: tidak di halaman publik, tidak di berkas medan, tidak di
   dataset terbuka. Keduanya hanya dipakai untuk kalibrasi dan validasi di sisi server.
2. Setiap peta menampilkan atribusi peta dasar (OpenStreetMap, atau CARTO bila kunci CARTO dipakai) dan tidak
   disembunyikan.
3. Data turunan yang dipublikasikan (medan per ruas, daftar prioritas fasilitas) memuat atribusi OpenStreetMap, Open-Meteo,
   dan Copernicus.

## Data

| Sumber | Dipakai untuk | Lisensi dan syarat | Atribusi yang ditampilkan | Halaman resmi (dicek 16 Nov 2026) |
|---|---|---|---|---|
| OpenStreetMap | geometri dan atribut jalan, paket jalan, PMTiles, lokasi sekolah dan fasilitas kesehatan | Open Database License (ODbL) dari OpenStreetMap Foundation; tampilkan atribusi dan nyatakan bahwa data tersedia di bawah ODbL (format atribusi: pedoman atribusi OSMF) | "© kontributor OpenStreetMap" | https://www.openstreetmap.org/copyright (dibuka) |
| Tile peta OpenStreetMap | peta dasar bila tidak ada kunci CARTO | kebijakan pemakaian tile OSMF: hanya tampilan interaktif, atribusi terlihat, tanpa prefetch, unduh massal, atau pemakaian luring; tanpa SLA | "© OpenStreetMap" di kontrol atribusi peta | https://operations.osmfoundation.org/policies/tiles/ (dibuka) |
| Peta dasar CARTO | peta dasar bila `VITE_CARTO_BASEMAP_KEY` diisi | kunci API gratis wajib di luar platform CARTO; tanpa kunci tile diberi tanda "API KEY REQUIRED" | "© CARTO © OpenStreetMap" | https://docs.carto.com/faqs/carto-basemaps (pencarian) |
| Citra satelit Esri World Imagery | gaya peta "satelit" | syarat layanan Esri; atribusi wajib | "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community" | syarat layanan Esri (belum) |
| Open-Meteo (cuaca, ERA5, CAMS) | latar atmosfer dan cuaca per jam, prakiraan | data API berlisensi CC BY 4.0; wajib menyebut sumber, menautkan lisensi, dan menyatakan perubahan | "Data cuaca oleh Open-Meteo.com" | https://open-meteo.com/en/licence (dibuka) |
| CAMS (Copernicus Atmosphere Monitoring Service) | latar PM2,5 dan NO2 | lisensi Copernicus: bebas dan terbuka dengan atribusi yang jelas | "Generated using Copernicus Atmosphere Monitoring Service information 2026"; untuk data yang diubah: "Contains modified Copernicus Atmosphere Monitoring Service information 2026" | https://apps.ecmwf.int/datasets/licences/copernicus/ (pencarian) |
| Sentinel-5P TROPOMI (Copernicus) | kolom NO2 (tahap pengujian) | data Copernicus Sentinel bebas, penuh, dan terbuka dengan atribusi | "Contains modified Copernicus Sentinel data 2026" | lisensi Copernicus (belum) |
| WAQI (aqicn.org) | kalibrasi dan validasi stasiun di server | kunci API wajib; atribusi WAQI dan EPA asal wajib; data tidak boleh dijual, dipakai di layanan berbayar, atau disebarkan ulang sebagai data tersimpan atau arsip; lembaga nirlaba memberi tahu tim WAQI lewat email sebelum pemakaian publik | "World Air Quality Index Project dan EPA asal" di mana pun nilai WAQI tampil | https://aqicn.org/api/tos/ (dibuka) |
| IQAir AirVisual API | kalibrasi dan validasi di server | paket Community (gratis) dibatasi panggilan per menit, hari, dan bulan; syarat lisensi API tidak ditemukan di halaman publik pada 16 Nov 2026, jadi diperlakukan sebagai tidak boleh dipublikasikan ulang | "IQAir" bila nilai IQAir tampil | https://www.iqair.com/air-quality-monitors/api (pencarian; halaman syarat 404) |
| OpenAQ (termasuk sensor AirGradient) | sensor warga: kriging latar medan per jam (`scripts/field/measure.ts`), kalibrasi, validasi | lisensi berbeda per penyedia data (CC, lisensi pemerintah, atau syarat khusus) dan wajib dipatuhi; catatan lokasi sensor AirGradient di Bali berlisensi CC BY 4.0 (dicek 16 Nov 2026); atribusi ke OpenAQ wajib; satu kunci per orang; dilarang mengambil data dari tampilan web | "Sensor warga: OpenAQ (AirGradient, CC BY 4.0)" di kontrol atribusi peta | https://docs.openaq.org/about/terms (dibuka) |
| METAR (Iowa Environmental Mesonet) | jarak pandang dan cuaca bandara; aturan asap Koschmieder di pembangun medan | domain publik; atribusi dihargai, tidak diwajibkan | "Iowa Environmental Mesonet, Iowa State University" | https://mesonet.agron.iastate.edu/disclaimer.php (dibuka) |
| NASA FIRMS (VIIRS) | titik panas (tahap pengujian) | data terbuka NASA; bila diteruskan ke pihak lain, ikuti pedoman sitasi dan sertakan disklaimer | "NASA FIRMS (LANCE, ESDIS)"; DOI S-NPP 10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002, NOAA-20 10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002 | halaman sitasi LANCE/FIRMS NASA (pencarian) |
| ISPU (KLHK) | validasi silang antarjaringan (rencana) | data pemerintah; syarat dicek saat dipakai | "ISPU, Kementerian Lingkungan Hidup dan Kehutanan" | situs ISPU KLHK (belum) |

## Layanan dan komponen

| Komponen | Kegunaan | Catatan |
|---|---|---|
| Anthropic API (model Haiku dan Sonnet) | klasifikasi ruas jalan dan asisten tanya-jawab di sisi server | dipanggil hanya dari server; kunci tidak pernah masuk bundel klien (`pnpm check:bundle`) |
| OpenRouteService | rute dan geocoding | lewat proxy server `/api/searchapi?provider=ors`; kunci di server |
| SearchAPI, Geoapify | pencarian tempat | lewat proxy server dengan daftar putih parameter |
| Supabase, Vercel, AWS, Hugging Face | database pengguna, hosting, komputasi, penyimpanan, data terbuka | tingkat gratis dan kredit |
| Leaflet, VectorGrid, PMTiles (Protomaps), React, Vite | aplikasi web | perangkat lunak sumber terbuka (BSD, MIT) |

## Pernyataan penggunaan kecerdasan artifisial

Pengembangan Breeva memakai alat bantu AI generatif untuk pemrograman, analisis data, penelusuran pustaka, dan penyuntingan
naskah, seperti dinyatakan di Lampiran 1 proposal TEKNOPAK AWARD 2026. Seluruh rancangan, data, angka, dan kesimpulan diperiksa
oleh tim dan menjadi tanggung jawab tim. Model AI di dalam aplikasi (tabel komponen di atas) dipakai di sisi server untuk
klasifikasi ruas jalan dan asisten tanya-jawab; jawabannya tidak dipakai sebagai hasil ukur kualitas udara.
