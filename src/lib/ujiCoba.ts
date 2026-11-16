/** Content of the student trial guide /uji-coba (task F4-01, trial 26 Nov-2 Dec 2026). Pure, tested. */
export interface Step { title: string; body: string; link?: { label: string; to: string } }

export const TRIAL_DATES = '26 November–2 Desember 2026';

export const STEPS: Step[] = [
  { title: 'Buka peta', body: 'Buka breeva.site di ponsel. Tidak perlu akun. Peta menunjukkan udara per ruas jalan di Badung–Denpasar.', link: { label: 'Buka peta', to: '/peta' } },
  { title: 'Pilih sekolahmu', body: 'Tekan "Rute di perangkat", lalu ketik nama sekolahmu di kolom "Ke sekolah" dan pilih dari daftar.' },
  { title: 'Ketuk titik berangkat', body: 'Ketuk rumah, kos, atau halte tempatmu berangkat. Titik itu hanya dipakai di ponselmu dan tidak dikirim ke mana pun.' },
  { title: 'Bandingkan rute', body: 'Lihat rute tercepat dan rute terbersih: berapa menit lebih lama, berapa persen NO₂ lebih rendah. Ganti ke "Motor" untuk melihat paparan yang ditimbulkan bagi orang lain.' },
  { title: 'Coba jam masuk sekolah', body: 'Ubah "Berangkat" ke 06.45. Rute motor tidak lewat jalan kecil di depan sekolah pada jam masuk dan pulang.' },
  { title: 'Simpan rutemu', body: 'Tekan "Salin tautan rute" dan simpan tautannya. Guru juga bisa membagikan tautan rute ke kelas.' },
];

export const PRIVACY = 'Uji coba ini tidak meminta nama, akun, atau lokasi rumah. Rute dihitung di ponselmu sendiri.';

/** Address the QR code on the guide points to. */
export function trialUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/uji-coba`;
}
