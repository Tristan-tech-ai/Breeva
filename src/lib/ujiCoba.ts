/** Content of the student trial guide /uji-coba (task F4-01, trial 26 Nov-2 Dec 2026). Pure, tested. */
export interface Step { title: string; body: string; link?: { label: string; to: string } }

export const TRIAL_DATES = '26 November–2 Desember 2026';

export const STEPS: Step[] = [
  { title: 'Buka peta', body: 'Buka breeva.site di ponsel. Tidak perlu akun. Peta langsung menunjukkan asap kendaraan per ruas jalan di Badung–Denpasar (Kota Bogor juga ada): makin ungu, makin banyak gas buang.', link: { label: 'Buka peta', to: '/peta' } },
  { title: 'Pilih sekolahmu', body: 'Tekan "Rute di perangkat", lalu ketik nama sekolahmu di kolom "Ke sekolah" dan pilih dari daftar.' },
  { title: 'Ketuk titik berangkat', body: 'Ketuk rumah, kos, atau halte tempatmu berangkat. Rute dihitung di ponselmu; titik itu tidak dikirim ke server Breeva (peta hanya memuat data area yang sedang kamu lihat).' },
  { title: 'Bandingkan rute', body: 'Lihat rute tercepat dan rute paling sedikit asap kendaraan: berapa menit lebih lama, dan berapa persen asap kendaraan yang kamu hirup berkurang. Ganti ke "Motor" untuk melihat paparan yang ditimbulkan bagi orang lain (harga hirup).' },
  { title: 'Coba jam masuk sekolah', body: 'Ubah "Berangkat" ke 06.45. Rute motor tidak lewat jalan kecil di depan sekolah pada jam masuk dan pulang, dan kartunya menyebut berapa menit dan meter yang ditambahkan zona sekolah.' },
  { title: 'Simpan rutemu', body: 'Tekan "Salin tautan rute" dan simpan tautannya. Tautan itu memuat titik berangkatmu, jadi bagikan hanya ke guru. Guru juga bisa membagikan tautan rute ke kelas.' },
];

export const PRIVACY = 'Uji coba ini tidak meminta nama, akun, atau lokasi rumah. Rute dihitung di ponselmu sendiri.';

/** Address the QR code on the guide points to. */
export function trialUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/uji-coba`;
}
