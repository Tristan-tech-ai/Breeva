# Sumber sensor PM2,5 terbuka untuk Indonesia

Diperiksa 26 Nov 2026, 22.00-23.00 WIB. Angka titik dihitung dari API atau halaman resmi pada malam itu, bukan dari klaim
(berkas: `D:/breeva-ml-data/field/reports/openaq_tinjau_2026-11-26.json`, `sumber_sensor/hitung_api_2026-11-26.json`,
`sumber_sensor/airgradient_segar_2026-11-26.json`). Wilayah hitung: Bali = kotak -8,9..-8,0 / 114,4..115,8; Kota Bogor =
25 km dari pusat kota; sepuluh kota 2027 = 30 km dari pusat kota. URL dan tanggal baca ada di `.claude/loop/LEARN.md`.

Aturan pakai: sumber baru masuk angka peta hanya sesudah lolos uji sensor disembunyikan (M-S03) dan bila lisensinya jelas
mengizinkan; selain itu paling jauh "hanya tampil" dengan atribusi, atau tidak dipakai.

## Ringkasan angka (titik aktif)

| Sumber | Indonesia | Bali | Kota Bogor 25 km | Jakarta | Malang | Medan | Bandung | Semarang | Palembang | Yogya, Surakarta, Makassar |
|---|---|---|---|---|---|---|---|---|---|---|
| OpenAQ, semua penyedia, aktif 7 hari | 50 | 42 | 1 | 5 | 1 | 1 | 0 | 0 | 0 | 0 |
| AirGradient peta publik, online, 24 jam | 142 | 44 | 1 | 11 | 26 | 0 | 1 | 1 | 0 | 0 |
| AirGradient publik yang tidak ada di OpenAQ | 101 | 7 | 0 | 7 | 26 | 0 | 1 | 1 | 0 | 0 |
| Sensor.Community, debu, 5 menit terakhir | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| openSenseMap, semua kotak (tanpa saring PM) | 11 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| Smart Citizen, semua perangkat | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| SPKU Jakarta (udara.jakarta.go.id) | kode SPKU di halaman: 97 | - | - | 97 | - | - | - | - | - | - |

Temuan terpenting: peta publik AirGradient memuat 101 lokasi Indonesia yang tidak lewat OpenAQ, termasuk 26 di Malang (salah satu
dari sepuluh kota 2027, yang di OpenAQ hanya punya 1). Lisensinya belum jelas (lihat butir 2), jadi belum dipakai.

## Per sumber

1. **OpenAQ** (api.openaq.org v3). Akses: kunci API gratis (sudah ada). Lisensi: per lokasi, dari pemilik data; OpenAQ meminta
   pengguna memeriksa lisensi pemilik dan memberi atribusi. Status: **dipakai di angka peta** (28 sensor Badung-Denpasar, lolos uji
   statis). Tinjau ulang 26 Nov: 0 lokasi baru sejak 14 Nov; 10 sensor Badung-Denpasar yang kini cukup data diuji tambah dan
   ditolak (galat harian 24,3% lawan 23,9%).
2. **AirGradient, API publik** (api.airgradient.com/public/api/v1/world/locations/measures/current). Akses: tanpa kunci. Lisensi:
   spesifikasi API tidak menyebut lisensi data; syarat situs AirGradient memberi lisensi CC-BY-SA hanya untuk desain perangkat keras
   dan kode, dan melarang pengambilan isi situs tanpa izin tertulis. Status: **belum dipakai**; minta izin tertulis lebih dulu
   (draf surat M-S04). Bila diizinkan: uji tambah-sensor seperti M-S02 sebelum masuk peta.
3. **Sensor.Community** (data.sensor.community). Akses: tanpa kunci. Lisensi: isi basis data ODC DbCL 1.0 (tautan "DB Contents
   License" di kaki situs). Status: **boleh dipakai dengan atribusi**, tetapi hanya 6 titik di Indonesia (1 di Palembang); tidak
   menambah apa pun untuk Bali dan Bogor.
4. **openSenseMap** (api.opensensemap.org). Akses: tanpa kunci. Lisensi data: belum terbaca di halaman resmi (dokumen dimuat skrip;
   README API hanya menyebut lisensi kode MIT). Status: 11 kotak di Indonesia, belum dicek apakah mengukur PM2,5; tidak dipakai.
5. **Smart Citizen** (api.smartcitizen.me). 0 perangkat di Indonesia. Tidak relevan sekarang.
6. **PurpleAir** (develop.purpleair.com). Akses: kunci API (halaman pengembang dimuat skrip, isinya belum terbaca). Jumlah titik
   belum dihitung. Status: belum diperiksa tuntas; butuh kunci gratis dari Tristan bila ingin dihitung.
7. **Clarity** (clarity.io OpenMap). Pemilik sensor Clarity boleh memilih membagikan data ke OpenMap tanpa biaya. Di OpenAQ ada 2
   lokasi Clarity di Indonesia, keduanya tidak aktif. Status: tidak ada data aktif.
8. **AirNow / Kedutaan AS Jakarta** (docs.airnowapi.org). Di OpenAQ: AirNow 2 dan StateAir 2 lokasi, semuanya tidak aktif 7 hari
   terakhir. Syarat AirNow: data belum terverifikasi, untuk pelaporan dan prakiraan AQI, tidak untuk dasar regulasi. Status: tidak
   ada data aktif.
9. **SPKU DKI Jakarta** (udara.jakarta.go.id). Halaman menampilkan ISPU dan PM2,5 per SPKU, diperbarui per jam (contoh 26 Nov
   21.30 WIB: DKI1 Bundaran HI PM2,5 71,42 µg/m³). Lisensi dan API terbuka belum ditemukan. Status: **minta izin ke DLH DKI**
   (draf surat M-S04); penting untuk Jabodetabek 2027.
10. **ISPU KLHK** (ispu.menlhk.go.id). Tidak terbuka dari jaringan ini malam ini (tanpa jawaban). Arsip Breeva mencatat 153 stasiun
    nasional, Bali 2, Kota Bogor tidak ada (14 Nov). Status: periksa ulang; minta akses data per jam lewat surat.
11. **BMKG kualitas udara** (bmkg.go.id). Halaman kualitas udara yang dicoba menjawab 404. Status: belum ditemukan halaman resmi
    yang masih aktif; periksa ulang.
12. **WAQI** (aqicn.org). Syarat layanan: data tidak boleh dijual, tidak untuk aplikasi berbayar, dan tidak boleh disebarkan ulang
    sebagai data tersimpan atau arsip. Status: **hanya kalibrasi internal, tidak pernah diterbitkan mentah** (sudah berlaku).
13. **IQAir** (iqair.com). Halaman resmi menolak permintaan otomatis malam ini (429). Status: seperti WAQI, pembacaan mentah tidak
    diterbitkan (aturan lama tetap).
14. **Nafas, kampus (IPB, ITB, UI, Udayana), Pemkot Bogor**: belum ditemukan API atau lisensi terbuka malam ini. Status: dimasukkan
    ke daftar surat permintaan data (M-S04).

## Program hibah atau pinjaman sensor

- **EPIC Air Quality Fund** (aqfund.epic.uchicago.edu): dana untuk lembaga dan pemerintah daerah yang memasang sensor di wilayah
  yang kurang terpantau dan membagikan data PM2,5 secara terbuka; sensor luar ruang saja. Putaran 2026 sudah tutup; menurut hasil
  pencarian (belum terbaca langsung dari halaman resmi malam ini) putaran berikutnya diumumkan musim gugur 2026 dan nilai hibah
  sekitar USD 50.000-75.000 untuk 18 bulan. Cocok untuk pemda (Pemkot Bogor, Pemkab Badung) bersama sekolah, bukan untuk tim siswa.
- **IQAir Schools4Earth**: program sponsor monitor untuk sekolah (berbayar lewat sponsor, bukan gratis), menurut hasil pencarian;
  halaman resmi menolak permintaan otomatis (429), jadi syaratnya belum terbaca langsung.
- **AirGradient, PurpleAir, OpenAQ, Clean Air Fund**: program hibah atau pinjaman sensor untuk sekolah di Indonesia belum
  ditemukan malam ini. Yang realistis dalam 2 minggu: meminjam 2 sensor dari dinas atau kampus untuk jadwal 14 hari di
  `docs/PROTOKOL_JALAN_TEST.md`.
