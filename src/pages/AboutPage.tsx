import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, Wind, Route, Trophy, Mail, MapPin, BarChart3, Store } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { Seo } from '../components/Seo';
import logoBreeva from '../assets/logo-breeva.svg';

const stats = [
  { label: 'Rilis', value: '2026' },
  { label: 'Platform', value: 'Web + PWA' },
  { label: 'Versi', value: 'Beta' },
];

const steps = [
  { n: '1', Icon: Wind, title: 'Lihat AQI per jalan', desc: 'Peta menampilkan kualitas udara terkini di tiap ruas jalan dari mesin VAYU.' },
  { n: '2', Icon: Route, title: 'Pilih rute terbersih', desc: 'Tiga opsi rute — Bersih, Seimbang, Cepat — lengkap dengan skor udara & estimasi paparan.' },
  { n: '3', Icon: Leaf, title: 'Jalan & kumpulkan EcoPoin', desc: 'Lacak jalanmu, pantau paparan PM2.5, dan raih EcoPoin, level, serta pencapaian.' },
];

const features = [
  { Icon: Wind, tint: 'text-sky-500', label: 'AQI per-ruas', desc: 'Peta udara kalibrasi VAYU' },
  { Icon: Route, tint: 'text-primary-500', label: 'Rute bersih', desc: '3 opsi sadar-polusi' },
  { Icon: Leaf, tint: 'text-emerald-500', label: 'EcoPoin & Level', desc: 'Hadiah untuk jalan kaki' },
  { Icon: BarChart3, tint: 'text-violet-500', label: 'Kalkulator Paparan', desc: 'Dosis PM2.5 per rute' },
  { Icon: Trophy, tint: 'text-amber-500', label: 'Papan Peringkat', desc: 'Desa → Nasional' },
  { Icon: Store, tint: 'text-orange-500', label: 'Merchant Eco', desc: 'Tukar poin jadi hadiah' },
];

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <Seo title="Tentang Breeva — Platform Intelijen Udara" description="Breeva memetakan kualitas udara per-jalan, menemukan rute jalan kaki paling bersih, dan menghitung paparan PM2.5 — platform navigasi udara untuk kota Indonesia." path="/about" />
      <PageHeader title="Tentang Breeva" onBack={() => navigate(-1)} />

      <div className="max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-5">
        {/* Brand hero */}
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-white dark:bg-gray-900 shadow-lg flex items-center justify-center mb-4 ring-2 ring-primary-100 dark:ring-primary-900/40">
            <img src={logoBreeva} alt="Breeva" className="w-12 h-12 object-contain" />
          </div>
          <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">Breeva</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Intelijen udara & navigasi bersih untuk kota</p>
          <div className="flex gap-2 mt-3">
            {stats.map((s) => (
              <div key={s.label} className="px-3 py-1.5 rounded-full bg-primary-50 dark:bg-primary-900/20 text-xs font-semibold text-primary-600 dark:text-primary-400">{s.value}</div>
            ))}
          </div>
        </motion.div>

        <SectionCard title="Misi Kami" icon={<Leaf className="w-4 h-4 text-primary-500" />}>
          <p className="leading-relaxed">
            Breeva membuat kualitas udara <b>terlihat di setiap ruas jalan</b>, lalu mengubah jalan kaki menjadi
            pilihan yang cerdas, sehat, dan bermanfaat.
          </p>
          <p className="leading-relaxed mt-3">
            Tujuan kami: menurunkan paparan polusi & emisi kota dengan memandu warga ke rute paling bersih dan
            memberi penghargaan atas tiap langkah rendah-emisi.
          </p>
        </SectionCard>

        <SectionCard title="Cara Kerja">
          <div className="space-y-4">
            {steps.map((s) => (
              <div key={s.n} className="flex gap-3">
                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-white text-xs font-bold shrink-0">{s.n}</div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><s.Icon className="w-3.5 h-3.5 text-primary-500" />{s.title}</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Fitur Utama">
          <div className="grid grid-cols-2 gap-3">
            {features.map((f) => (
              <div key={f.label} className="flex items-start gap-2.5">
                <f.Icon className={`w-5 h-5 shrink-0 ${f.tint}`} />
                <div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">{f.label}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Dibangun Dengan">
          <div className="flex flex-wrap gap-2">
            {['React 19', 'TypeScript', 'Vite', 'Tailwind CSS v4', 'Leaflet', 'Supabase (PostgreSQL + PostGIS)', 'Valhalla', 'Mesin VAYU', 'Framer Motion', 'Zustand'].map((t) => (
              <span key={t} className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-[10px] font-medium text-gray-600 dark:text-gray-400">{t}</span>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Kontak">
          <a href="mailto:halo@breeva.site" className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-500 transition">
            <Mail className="w-4 h-4" /> halo@breeva.site
          </a>
          <a href="https://breeva.site" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-500 transition mt-2.5">
            <MapPin className="w-4 h-4" /> breeva.site
          </a>
        </SectionCard>

        <div className="text-center pt-1">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">© 2026 Breeva. Hak cipta dilindungi.</p>
          <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">Dibuat dengan 💚 untuk udara yang lebih bersih</p>
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
