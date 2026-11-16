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
