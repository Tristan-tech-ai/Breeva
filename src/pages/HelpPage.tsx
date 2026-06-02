import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageCircle, Mail, FileText, ChevronRight, ExternalLink, Search, Leaf, Map, Wallet, Shield, Smartphone } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import PageHeader from '../components/ui/PageHeader';
import { Seo } from '../components/Seo';

interface FAQItem { question: string; answer: string; category: string; }

const faqs: FAQItem[] = [
  { category: 'Mulai', question: 'Bagaimana cara memulai jalan?', answer: 'Buka peta (tab Beranda), cari atau ketuk tujuan, lalu tap "Mulai" pada kartu rute. Breeva melacak jalanmu dan memberi EcoPoin saat selesai.' },
  { category: 'Mulai', question: 'Apa itu EcoPoin?', answer: 'EcoPoin adalah hadiah yang kamu dapat dari berjalan kaki dan memilih rute bersih. Tukarkan di merchant ramah lingkungan untuk diskon & perk.' },
  { category: 'Mulai', question: 'Beda rute bersih dan rute cepat?', answer: 'Rute bersih menghindari area berudara buruk dan mengutamakan jalur hijau. Bisa sedikit lebih jauh, tapi udaranya lebih sehat dan EcoPoin-nya lebih banyak.' },
  { category: 'Rute & Peta', question: 'Kenapa warna rute di peta berbeda?', answer: 'Hijau = Rute Bersih (udara terbaik), Biru = Seimbang, Oranye = Cepat. Tiap rute punya jarak, durasi, dan kualitas udara yang berbeda.' },
  { category: 'Rute & Peta', question: 'Apa itu AQI dan dari mana datanya?', answer: 'AQI (Indeks Kualitas Udara) menunjukkan seberapa bersih udara. Breeva memakai mesin VAYU yang mengkalibrasi AQI per-ruas jalan (dengan baseline data satelit & Open-Meteo). Makin rendah AQI, makin bersih.' },
  { category: 'Rute & Peta', question: 'Bisa pakai moda transportasi lain?', answer: 'Bisa! Breeva mendukung Jalan kaki, Sepeda, Motor, dan Mobil. Jalan kaki & sepeda memberi EcoPoin terbanyak karena nol emisi.' },
  { category: 'EcoPoin & Hadiah', question: 'Bagaimana EcoPoin dihitung?', answer: 'EcoPoin dihitung dari jarak jalan kaki yang terverifikasi, ditambah bonus dari misi harian dan pencapaian. Moda bermotor memberi poin lebih sedikit.' },
  { category: 'EcoPoin & Hadiah', question: 'Di mana menukar EcoPoin?', answer: 'Buka tab Hadiah untuk melihat voucher dari merchant. Ketuk voucher untuk menukarnya dengan saldo EcoPoin-mu.' },
  { category: 'Akun & Privasi', question: 'Apakah data lokasi saya privat?', answer: 'Ya. Lokasi dipakai untuk navigasi dan AQI di sekitarmu, dan tidak dijual atau dibagikan ke pihak ketiga untuk iklan. Lihat Kebijakan Privasi untuk detail.' },
  { category: 'Akun & Privasi', question: 'Bagaimana menghapus akun?', answer: 'Buka Profil → Pengaturan, atau hubungi kami di halo@breeva.site. Penghapusan bersifat permanen.' },
];

const categories = ['Semua', 'Mulai', 'Rute & Peta', 'EcoPoin & Hadiah', 'Akun & Privasi'];
const categoryIcons: Record<string, React.ReactNode> = {
  'Mulai': <Leaf className="w-4 h-4" />,
  'Rute & Peta': <Map className="w-4 h-4" />,
  'EcoPoin & Hadiah': <Wallet className="w-4 h-4" />,
  'Akun & Privasi': <Shield className="w-4 h-4" />,
};

export default function HelpPage() {
  const navigate = useNavigate();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('Semua');

  const filtered = faqs.filter((f) => {
    const s = !query || f.question.toLowerCase().includes(query.toLowerCase()) || f.answer.toLowerCase().includes(query.toLowerCase());
    return s && (cat === 'Semua' || f.category === cat);
  });

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <Seo title="Bantuan & Masukan — Breeva" description="Pertanyaan umum seputar Breeva: memulai jalan, rute, AQI, EcoPoin, dan privasi." path="/help" />
      <PageHeader title="Bantuan & Masukan" onBack={() => navigate(-1)} />

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-5">
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl glass-card">
          <Search size={18} className="text-gray-400 dark:text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari bantuan…"
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`flex-shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5 ${
                c === cat ? 'gradient-primary text-white shadow-sm' : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300'
              }`}
            >
              {c !== 'Semua' && categoryIcons[c]}{c}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Search size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Tidak ada pertanyaan yang cocok</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Coba kata kunci lain atau hubungi kami di bawah</p>
            </div>
          ) : (
            filtered.map((faq, i) => (
              <motion.div key={faq.question} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.25) }} className="glass-card overflow-hidden">
                <button onClick={() => setOpenIdx(openIdx === i ? null : i)} className="w-full flex items-center justify-between px-4 py-3.5 text-left gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-primary-500 mt-0.5 flex-shrink-0">{categoryIcons[faq.category] || <Smartphone className="w-4 h-4" />}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{faq.question}</span>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${openIdx === i ? 'rotate-90' : ''}`} />
                </button>
                {openIdx === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="px-4 pb-4 pl-11">
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{faq.answer}</p>
                  </motion.div>
                )}
              </motion.div>
            ))
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">Masih butuh bantuan?</h3>
          <div className="space-y-2">
            <a href="mailto:halo@breeva.site?subject=Bantuan%20Breeva" className="glass-card flex items-center gap-3 px-4 py-3.5">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center"><Mail className="w-4 h-4 text-blue-500" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-gray-900 dark:text-white">Email Dukungan</p><p className="text-[10px] text-gray-400 dark:text-gray-500">halo@breeva.site</p></div>
              <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </a>
            <button onClick={() => navigate('/contribute')} className="glass-card flex items-center gap-3 px-4 py-3.5 w-full text-left">
              <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center"><MessageCircle className="w-4 h-4 text-primary-500" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-gray-900 dark:text-white">Laporkan Masalah</p><p className="text-[10px] text-gray-400 dark:text-gray-500">Bantu sempurnakan Breeva</p></div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </button>
            <button onClick={() => navigate('/about')} className="glass-card flex items-center gap-3 px-4 py-3.5 w-full text-left">
              <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><FileText className="w-4 h-4 text-gray-500 dark:text-gray-400" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-gray-900 dark:text-white">Tentang Breeva</p><p className="text-[10px] text-gray-400 dark:text-gray-500">Pelajari misi kami</p></div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
