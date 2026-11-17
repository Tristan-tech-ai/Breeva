/** Content of the student trial guide /uji-coba (task F4-01, trial 26 Nov-2 Dec 2026). Pure, tested. */
export interface Step { title: string; body: string; link?: { label: string; to: string } }

export const TRIAL_DATES = '26 November–2 Desember 2026';

export const STEPS: Step[] = [
  { title: 'Nyalakan catatan', body: 'Di halaman breeva.site/uji-coba (kode QR di lembar ini), tekan "Nyalakan catatan". Ponselmu mencatat hari-hari kamu memakai rute, tanpa lokasi. Di hari terakhir, tekan "Salin kode ringkasan" dan tempel kodenya di kuesioner dari guru.' },
  // F4-16: on a weak 3G signal the first visit takes about 25 s, a visit after one on Wi-Fi about 7 s
  // (lambat3g_sesudah_2026-11-18.json, kunjungan2_3g_2026-11-18.json)
  { title: 'Pertama kali, pakai Wi-Fi sekolah', body: 'Buka breeva.site/peta sekali saat tersambung Wi-Fi sekolah, lalu di breeva.site/status tekan "Simpan Badung–Denpasar untuk tanpa internet" (atau Kota Bogor). Di sinyal 3G yang lemah, kunjungan pertama butuh sekitar 25 detik; sesudah itu peta dan rute muncul dalam sekitar 7 detik dan tetap jalan tanpa internet.', link: { label: 'Buka halaman status', to: '/status' } },
  { title: 'Buka peta', body: 'Buka breeva.site di ponsel. Tidak perlu akun. Peta langsung menunjukkan asap kendaraan per ruas jalan di Badung–Denpasar (Kota Bogor juga ada): makin ungu, makin banyak gas buang.', link: { label: 'Buka peta', to: '/peta' } },
  { title: 'Pilih sekolahmu', body: 'Tekan "Rute di perangkat", lalu ketik nama sekolahmu di kolom "Ke sekolah" dan pilih dari daftar.' },
  { title: 'Ketuk titik berangkat', body: 'Ketuk rumah, kos, atau halte tempatmu berangkat, atau tekan "Pakai lokasiku" bila kamu sedang di sana. Rute dihitung di ponselmu; titik itu tidak dikirim ke server Breeva (peta hanya memuat data area yang sedang kamu lihat, dan "Pakai lokasiku" mengirim lokasi yang dibulatkan sekitar 1 km untuk kartu kualitas udara).' },
  { title: 'Bandingkan rute', body: 'Lihat rute tercepat dan rute paling sedikit asap kendaraan: berapa menit lebih lama, dan berapa persen asap kendaraan yang kamu hirup berkurang. Ganti ke "Motor" untuk melihat paparan yang ditimbulkan bagi orang lain (harga hirup).' },
  { title: 'Coba jam masuk sekolah', body: 'Ubah "Berangkat" ke 06.45. Rute motor tidak lewat jalan kecil di depan sekolah pada jam masuk dan pulang, dan kartunya menyebut berapa menit dan meter yang ditambahkan zona sekolah.' },
  { title: 'Simpan rutemu', body: 'Tekan "Salin tautan rute" dan simpan tautannya. Tautan itu memuat titik berangkatmu, jadi bagikan hanya ke guru. Guru juga bisa membagikan tautan rute ke kelas.' },
];

export const PRIVACY = 'Uji coba ini tidak meminta nama, akun, atau lokasi rumah. Rute dihitung di ponselmu sendiri; catatan uji coba hanya menyimpan tanggal, moda, dan angka perbandingan rute, dan baru keluar dari ponselmu bila kamu menyalin kodenya.';

/** The printable A4 sheet of the same steps (public/panduan-uji-coba.pdf, built from these strings; task F4-05/F4-06). */
export const PRINT_SHEET = { label: 'Unduh lembar A4 untuk dicetak', href: '/panduan-uji-coba.pdf' };

/** Address the QR code on the guide points to. */
export function trialUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/uji-coba`;
}
