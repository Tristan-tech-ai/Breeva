import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import { Seo } from '../components/Seo';

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="gradient-mesh-bg min-h-screen pb-12">
      <Seo title="Kebijakan Privasi — Breeva" description="Bagaimana Breeva mengumpulkan, memakai, dan melindungi datamu." path="/privacy" />
      <PageHeader title="Kebijakan Privasi" onBack={() => navigate(-1)} />

      <div className="max-w-2xl mx-auto px-4 pt-5 pb-10">
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 px-1">Terakhir diperbarui: 2 Juni 2026</p>

        <div className="glass-card p-5 space-y-5">
          <Section title="1. Pendahuluan">
            Breeva ("kami") menghormati privasimu. Kebijakan ini menjelaskan bagaimana kami mengumpulkan,
            menggunakan, menyimpan, dan melindungi informasimu saat memakai aplikasi navigasi eco-walk kami.
          </Section>

          <Section title="2. Informasi yang Kami Kumpulkan">
            <Sub title="a) Informasi Akun" body="Saat masuk dengan Google atau email, kami menerima nama, alamat email, dan foto profil untuk membuat & mengelola akun Breeva-mu." />
            <Sub title="b) Data Lokasi" body="Kami mengakses lokasi perangkat untuk navigasi, pelacakan rute, dan info kualitas udara. Lokasi dipakai real-time dan disimpan sebagai riwayat jalan di akunmu." />
            <Sub title="c) Data Jalan & Aktivitas" body="Jarak, durasi, koordinat rute, moda transportasi, dan EcoPoin disimpan untuk dasbor dampak lingkungan, riwayat jalan, dan pencapaian." />
            <Sub title="d) Konten dari Pengguna" body="Laporan via fitur Kontribusi (mis. tempat hilang, laporan udara) disimpan dan dapat berisi lokasi serta teks deskripsi." />
            <Sub title="e) Jejak Udara Pasif (VAYU)" body="Saat menyelesaikan jalan, Breeva dapat merekam jejak pergerakan untuk membangun peta AQI per-ruas jalan: ruas/­sel grid kasar (~150 m) yang kamu lewati, perkiraan kecepatan, dan moda — tanpa nama, email, atau jejak GPS presisi. Karena kamu mendapat +5 EcoPoin per sesi, jejak ini terhubung ke akunmu lewat ledger (pseudonim, bukan sepenuhnya anonim). Bisa dimatikan di Pengaturan → Privasi." />
          </Section>

          <Section title="3. Cara Kami Memakai Data">
            <List items={[
              'Menyediakan & menyempurnakan navigasi dan saran rute bersih.',
              'Menampilkan kualitas udara di sepanjang rutemu.',
              'Menghitung dampak lingkunganmu (CO₂ dihemat, setara pohon).',
              'Mengelola EcoPoin, level, dan pencapaian.',
              'Mengaktifkan penukaran hadiah di merchant mitra.',
              'Meningkatkan keandalan aplikasi lewat analitik anonim.',
            ]} />
          </Section>

          <Section title="4. Penyimpanan & Keamanan">
            <List items={[
              'Data disimpan di Supabase (PostgreSQL) dengan Row Level Security (RLS) — kamu hanya bisa mengakses datamu sendiri.',
              'Semua komunikasi aplikasi–server memakai enkripsi HTTPS.',
              'Autentikasi via Supabase Auth (Google OAuth 2.0 / email OTP).',
              'Kami tidak menyimpan kata sandi Google-mu; token dikelola aman oleh platform.',
            ]} />
          </Section>

          <Section title="5. Pembagian Data">
            Kami <strong>tidak</strong> menjual, menyewakan, atau membagikan data pribadimu untuk iklan.
            <List items={[
              'Merchant: saat menukar hadiah, merchant hanya menerima kode voucher & status — bukan data pribadimu.',
              'Penyedia API: permintaan rute dikirim ke mesin Valhalla (dengan fallback OpenRouteService); kueri kualitas udara diproses mesin VAYU (baseline Open-Meteo/Sentinel). Berisi koordinat, bukan identitas pribadi.',
              'Papan peringkat: nama tampilan & skormu terlihat oleh pengguna lain.',
            ]} />
          </Section>

          <Section title="6. Hak Kamu">
            <List items={[
              'Akses: lihat seluruh datamu via Profil, Riwayat Jalan, dan Eco Impact.',
              'Koreksi: ubah informasi profil kapan saja via Edit Profil.',
              'Penghapusan: hapus datamu lewat Pengaturan atau hubungi kami (permanen).',
              'Portabilitas: hubungi kami untuk salinan datamu dalam format yang dapat dibaca mesin.',
            ]} />
          </Section>

          <Section title="7. Cookie & Penyimpanan Lokal">
            Breeva memakai local storage browser untuk menyimpan preferensi (mis. mode gelap, pengaturan) dan sesi
            login. Kami tidak memakai cookie pelacak pihak ketiga.
          </Section>

          <Section title="8. Privasi Anak">
            Breeva tidak ditujukan untuk anak di bawah 13 tahun. Kami tidak sengaja mengumpulkan data anak; jika
            diketahui, akan segera kami hapus.
          </Section>

          <Section title="9. Perubahan Kebijakan">
            Kebijakan ini dapat diperbarui berkala. Perubahan tercermin pada tanggal "Terakhir diperbarui".
            Penggunaan berkelanjutan berarti kamu menerimanya.
          </Section>

          <Section title="10. Hubungi Kami">
            Pertanyaan tentang privasi atau ingin menggunakan hakmu? Hubungi{' '}
            <a href="mailto:halo@breeva.site" className="text-primary-600 dark:text-primary-400 underline font-medium">halo@breeva.site</a>.
          </Section>
        </div>

        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-6 text-center">© 2026 Breeva. Hak cipta dilindungi.</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5">{title}</h2>
      <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{children}</div>
    </div>
  );
}

function Sub({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-2.5 first:mt-1">
      <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-0.5">{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 mt-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-1.5 w-1 h-1 rounded-full bg-primary-400 shrink-0" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
