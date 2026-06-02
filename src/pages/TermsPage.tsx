import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import { Seo } from '../components/Seo';

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="gradient-mesh-bg min-h-screen pb-12">
      <Seo title="Ketentuan Layanan — Breeva" description="Ketentuan Layanan penggunaan aplikasi Breeva — navigasi udara bersih & eco-walk." path="/terms" />
      <PageHeader title="Ketentuan Layanan" onBack={() => navigate(-1)} />

      <div className="max-w-2xl mx-auto px-4 pt-5 pb-10">
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 px-1">Terakhir diperbarui: 2 Juni 2026</p>

        <div className="glass-card p-5 space-y-5">
          <Section title="1. Penerimaan Ketentuan">
            Dengan mengakses atau menggunakan aplikasi Breeva ("Layanan"), kamu setuju terikat pada Ketentuan
            Layanan ini. Jika tidak setuju, mohon untuk tidak menggunakan Layanan.
          </Section>

          <Section title="2. Tentang Layanan">
            Breeva adalah aplikasi (PWA) intelijen kualitas udara dan navigasi jalan kaki: memetakan AQI per-ruas
            jalan, menyarankan rute paling bersih, menghitung paparan PM2.5, serta memberi EcoPoin atas pilihan
            transportasi rendah emisi. Breeva juga menghubungkanmu dengan merchant ramah lingkungan.
          </Section>

          <Section title="3. Akun Pengguna">
            <List items={[
              'Masuk menggunakan Google atau email (OTP) untuk mengakses fitur personal.',
              'Kamu bertanggung jawab menjaga keamanan akunmu.',
              'Berikan informasi yang akurat dan terkini.',
              'Satu akun per orang. Akun ganda dapat dinonaktifkan.',
            ]} />
          </Section>

          <Section title="4. EcoPoin">
            <List items={[
              'EcoPoin adalah poin virtual, tidak dapat dipindahtangankan, dan tidak punya nilai tunai.',
              'Diperoleh dari jalan kaki terverifikasi, misi, dan pencapaian.',
              'Breeva dapat menyesuaikan tarif perolehan, masa berlaku, dan nilai penukaran sewaktu-waktu.',
              'Manipulasi (mis. GPS spoofing, jalan otomatis) berakibat penonaktifan akun & hangusnya poin.',
            ]} />
          </Section>

          <Section title="5. Data Lokasi & Privasi">
            Breeva memerlukan akses lokasi untuk navigasi, pelacakan rute, dan AQI di sekitarmu. Lokasi tidak
            dijual atau dibagikan ke pihak ketiga untuk iklan. Rincian lengkap ada di{' '}
            <button onClick={() => navigate('/privacy')} className="text-primary-600 dark:text-primary-400 underline font-medium">Kebijakan Privasi</button>.
          </Section>

          <Section title="6. Penggunaan yang Pantas">
            Kamu setuju untuk tidak:
            <List items={[
              'Menggunakan Layanan untuk tujuan melanggar hukum.',
              'Mengganggu atau merusak Layanan maupun servernya.',
              'Mengakses akun pengguna lain tanpa izin.',
              'Mengirim laporan, rating, atau konten palsu/menyesatkan.',
              'Menggunakan alat otomatis untuk berinteraksi dengan Layanan.',
            ]} />
          </Section>

          <Section title="7. Mitra Merchant">
            Breeva menghubungkanmu dengan merchant pihak ketiga. Kami tidak mengontrol dan tidak bertanggung jawab
            atas produk, layanan, atau praktik mereka. Syarat penukaran ditetapkan masing-masing merchant.
          </Section>

          <Section title="8. Penafian">
            Saran rute dan data kualitas udara disediakan "apa adanya" untuk tujuan informasi. Breeva tidak
            menjamin keakuratan mutlak rute, nilai AQI, maupun estimasi dampak lingkungan. Selalu gunakan
            penilaian pribadi dan patuhi peraturan lalu lintas.
          </Section>

          <Section title="9. Batasan Tanggung Jawab">
            Sejauh diizinkan hukum, Breeva tidak bertanggung jawab atas kerugian tidak langsung, insidental, atau
            konsekuensial yang timbul dari penggunaan Layanan, termasuk cedera, kerusakan properti, atau kehilangan data.
          </Section>

          <Section title="10. Perubahan">
            Kami dapat memperbarui Ketentuan ini sewaktu-waktu. Penggunaan berkelanjutan setelah perubahan berarti
            kamu menerima Ketentuan yang diperbarui. Perubahan besar akan diberitahukan di aplikasi.
          </Section>

          <Section title="11. Penghentian">
            Kami berhak menangguhkan atau menghentikan akun yang melanggar Ketentuan ini. Kamu dapat menghapus
            akunmu kapan saja melalui Pengaturan atau dengan menghubungi kami.
          </Section>

          <Section title="12. Kontak">
            Pertanyaan tentang Ketentuan ini? Hubungi{' '}
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
