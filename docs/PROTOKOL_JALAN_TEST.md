# Protokol jalan test Breeva

Tujuan: membandingkan bacaan sensor PM2,5 portabel dengan peta Breeva per ruas, terutama selisih antara jalan kecil
(gang, jalan lingkungan) dan jalan besar di dekatnya. Hasilnya diolah dengan
`pnpm exec tsx scripts/field/validate-transect.mts --csv <berkas.csv>`.

## Alat

- Sensor PM2,5 portabel yang menyimpan waktu tiap bacaan. Atmotube PRO 2 menyimpan posisi GPS sendiri; sensor rakitan
  (PMS5003) cukup dipasangkan dengan aplikasi pencatat GPS di ponsel yang bisa mengekspor GPX.
- Jam ponsel dan sensor disamakan sebelum berangkat (selisih kurang dari 30 detik).

## Cara berjalan

1. Nyalakan sensor 5 menit sebelum berangkat supaya kipasnya stabil. Bawa sensor setinggi dada, jangan di dalam tas.
2. Pilih pasangan titik: satu di jalan kecil dan satu di jalan besar terdekat, berjarak paling jauh 300 m.
3. Berdiri diam 3 menit di titik jalan kecil, lalu berjalan ke titik jalan besar dan berdiri diam 3 menit. Berdiri di
   tepi jalan, menghadap jalan, menjauhi asap rokok, warung bakaran, dan knalpot yang berhenti tepat di depanmu.
4. Satu kali jalan test: 3 sampai 5 pasangan titik. Ulangi di 3 jam berbeda (pagi berangkat sekolah, siang, sore).
5. Catat kejadian khusus di kertas (misalnya "ada pembakaran sampah" atau "macet total"), lengkap dengan jamnya.

## Privasi

- Mulai dan akhiri jalan test di rumah atau sekolah: skrip membuang semua bacaan dalam 150 m dari titik awal dan akhir.
- Yang disimpan di hasil hanya ruas jalan, waktu, dan angka; tidak ada nama atau alamat.

## Yang dihasilkan

- Daftar titik berhenti, ruas jalannya (kelas kecil atau besar), PM2,5 terukur, dan nilai model jam itu.
- Selisih jalan besar dikurangi jalan kecil, terukur dan menurut model, dengan rentang 95%.
- Model memprediksi selisih PM2,5 yang kecil (sumbangan lalu lintas ke PM2,5 di gang sekitar 0,05 µg/m³, di jalan
  besar sekitar 0,7 µg/m³) dan selisih NO₂ yang besar. Sensor PM2,5 murah tidak mengukur NO₂, jadi uji ini menguji
  bagian PM2,5 saja; hasil "tidak ada beda" juga hasil yang sah.

## Batasan

- Bacaan sensor murah dipakai mentah, tanpa koreksi kelembapan (koreksi versi AS memperburuk kecocokan di Bali).
- Run model per jam disimpan 7 hari: olah datanya paling lambat seminggu setelah jalan test.

## Pasangan pinggir jalan dan jadwal sensor pinjaman 14 hari (26 Nov 2026)

Tujuan: menguji model asap kendaraan per ruas, yang belum pernah dibandingkan dengan pengukuran di pinggir jalan. Tiap pasangan = ruas
utama dekat sekolah dengan asap model x harga hirup tertinggi, dan jalan kecil 100-150 m darinya dengan asap model terendah. Kondisi
rujukan model: jam 07.00, angin 1,5 m/s (sama dengan simulasi tutup jalan). Aturan pemilihan ditulis sebelum dihitung (catatan keputusan
26 Nov); berkas lengkap: `D:/breeva-ml-data/field/reports/pasangan_pinggir_jalan.json`.

### Badung-Denpasar (234 sekolah dekat jalan utama diperiksa)

| Pasangan | Sekolah | Titik jalan utama (model, µg/m³) | Titik jalan kecil (jarak, model) | Rasio model |
|---|---|---|---|---|
| 1 | Madrasah Ibtidiyah Al-Ukhuwwah | Jalan Diponegoro (secondary), -8.65886, 115.21478: 123,7 | living_street tanpa nama (living_street), -8.65983, 115.21373: 150 m, 5,1 | 24,5x |
| 2 | SMK Bintang Persada | Jalan Bypass Gatot Subroto (primary), -8.63665, 115.18567: 147,1 | living_street tanpa nama (living_street), -8.63792, 115.1873: 150 m, 6,6 | 22,3x |
| 3 | TK Hooraykids! | Jalan Teuku Umar Barat (trunk), -8.68134, 115.18972: 188,5 | service tanpa nama (service), -8.68191, 115.18822: 141 m, 7,1 | 26,5x |

Jadwal dua sensor pinjaman:

- Hari 1: berdampingan di Madrasah Ibtidiyah Al-Ukhuwwah (kalibrasi silang 24 jam).
- Hari 2-5: pasangan 1: sensor A di Jalan Diponegoro, sensor B di living_street tanpa nama.
- Hari 6-9: pasangan 2: sensor A di Jalan Bypass Gatot Subroto, sensor B di living_street tanpa nama.
- Hari 10-13: pasangan 3: sensor A di Jalan Teuku Umar Barat, sensor B di service tanpa nama.
- Hari 14: berdampingan lagi (cek pergeseran).

### Kota Bogor (600 sekolah dekat jalan utama diperiksa)

| Pasangan | Sekolah | Titik jalan utama (model, µg/m³) | Titik jalan kecil (jarak, model) | Rasio model |
|---|---|---|---|---|
| 1 | SDN 2 Margajaya | tertiary tanpa nama (tertiary), -6.57208, 106.74049: 110 | service tanpa nama (service), -6.57234, 106.73921: 144 m, 5,9 | 18,8x |
| 2 | SLB Bina Mandiri | Jalan Sholeh Iskandar (trunk), -6.56225, 106.80034: 232 | Jalan Raden Hasan (living_street), -6.56351, 106.80042: 137 m, 20,6 | 11,3x |
| 3 | TK Negeri Motekar | tertiary tanpa nama (tertiary), -6.59083, 106.78643: 122,7 | living_street tanpa nama (living_street), -6.59157, 106.78536: 142 m, 9,4 | 13x |

Jadwal dua sensor pinjaman:

- Hari 1: berdampingan di SDN 2 Margajaya (kalibrasi silang 24 jam).
- Hari 2-5: pasangan 1: sensor A di tertiary tanpa nama, sensor B di service tanpa nama.
- Hari 6-9: pasangan 2: sensor A di Jalan Sholeh Iskandar, sensor B di Jalan Raden Hasan.
- Hari 10-13: pasangan 3: sensor A di tertiary tanpa nama, sensor B di living_street tanpa nama.
- Hari 14: berdampingan lagi (cek pergeseran).

Cara membaca hasilnya: yang dibandingkan adalah lonjakan per menit dan selisih jalan utama dikurangi jalan kecil pada jam 06-09 dan 15-18,
bukan rata-rata jam (PM2,5 latar hampir sama di kedua titik). Model dianggap cocok bila arah selisihnya benar di ketiga pasangan dan
urutan besarnya sama dengan urutan rasio model; bila tidak, model asap kendaraan diberi catatan dan dikalibrasi ulang sebelum dipakai
untuk klaim. Pemasangan di pinggir jalan perlu izin pemilik tempat (pagar sekolah, warung); sensor tidak dipasang di trotoar umum.
