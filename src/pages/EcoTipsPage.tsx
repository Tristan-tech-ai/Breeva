import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { ChevronLeft, Leaf, Wind, Footprints, Droplets, TreePine, AlertTriangle } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import PageHeader from '../components/ui/PageHeader';
import { Seo } from '../components/Seo';

const tips = [
  { icon: Leaf, title: 'Jalan Kaki Hemat CO₂', body: 'Berjalan 1 km menghemat ~120 g CO₂ dibanding berkendara. Untuk komuter harian, itu bisa puluhan kilogram per tahun!', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' },
  { icon: Wind, title: 'Pilih Rute Lebih Bersih', body: 'Rute dekat taman & ruang hijau bisa jauh lebih minim polusi. Mesin VAYU Breeva mencarikan jalur terbersih untukmu.', color: 'text-sky-500 bg-sky-50 dark:bg-sky-900/20' },
  { icon: Footprints, title: '30 Menit Jalan Kaki', body: 'Berjalan 30 menit/hari menurunkan risiko penyakit jantung dan memperbaiki suasana hati. Olahraga gratis!', color: 'text-primary-500 bg-primary-50 dark:bg-primary-900/20' },
  { icon: TreePine, title: 'Pohon = Penyaring Udara', body: 'Satu pohon dapat menyerap ~22 kg CO₂ per tahun dan menyaring partikel berbahaya. Berjalanlah dekat pepohonan bila bisa.', color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
  { icon: Droplets, title: 'Hemat Air Juga', body: 'Mobil membutuhkan ~3,8 liter air per km (produksi + cuci). Dengan jalan kaki, kamu ikut menghemat sumber daya tersembunyi.', color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' },
  { icon: Leaf, title: 'EcoPoin = Hadiah Nyata', body: 'Tukar EcoPoin di merchant ramah lingkungan untuk diskon makanan, minuman, dan produk eco. Jalan kaki benar-benar membayar!', color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
  { icon: Wind, title: 'Jam Sibuk = Polusi Puncak', body: 'Udara terburuk saat jam sibuk (07.00–09.00 & 17.00–19.00). Jadwalkan jalanmu pagi atau sore untuk udara lebih bersih.', color: 'text-rose-500 bg-rose-50 dark:bg-rose-900/20' },
  { icon: Footprints, title: 'Rapat Sambil Jalan', body: 'Coba rapat sambil berjalan! Berjalan terbukti meningkatkan kreativitas. Baik untukmu DAN ide-idemu.', color: 'text-violet-500 bg-violet-50 dark:bg-violet-900/20' },
];

const aqTips = [
  { maxAqi: 50, icon: Leaf, title: 'Udara Sedang Bersih!', body: 'AQI di bawah 50 — sempurna untuk jalan kaki. Manfaatkan, jalan lebih jauh hari ini!', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' },
  { maxAqi: 100, icon: Wind, title: 'Udara Sedang', body: 'AQI 51–100. Jalan kaki masih aman untuk kebanyakan orang. Hindari olahraga berat dekat jalan ramai.', color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
  { maxAqi: 999, icon: AlertTriangle, title: 'Awas, Udara Buruk', body: 'AQI di atas 100. Pertimbangkan jalan lebih singkat, pakai masker, dan pilih jalur lewat taman & ruang hijau.', color: 'text-red-500 bg-red-50 dark:bg-red-900/20' },
];

function SwipeableCard({ tip, onDismiss }: { tip: typeof tips[number]; onDismiss: () => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-18, 18]);
  const opacity = useTransform(x, [-200, -100, 0, 100, 200], [0, 1, 1, 1, 0]);
  const Icon = tip.icon;
  return (
    <motion.div
      style={{ x, rotate, opacity }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 100) onDismiss(); }}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ x: 300, opacity: 0, transition: { duration: 0.2 } }}
      className="absolute inset-0 glass-card p-5 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tip.color}`}><Icon className="w-5 h-5" /></div>
        <div>
          <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider">Geser untuk jelajah</p>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">{tip.title}</h2>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed ml-[52px]">{tip.body}</p>
      <div className="mt-3 ml-[52px] flex items-center gap-1 text-[10px] text-gray-400"><ChevronLeft className="w-3 h-3" /> Geser untuk tip berikutnya</div>
    </motion.div>
  );
}

export default function EcoTipsPage() {
  const navigate = useNavigate();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [currentAqi, setCurrentAqi] = useState<number | null>(null);
  const [cardIdx, setCardIdx] = useState(0);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`/api/vayu/aqi?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
          if (res.ok) {
            const json = await res.json();
            setCurrentAqi(json.data?.aqi ?? json.aqi ?? null);
          }
        } catch { /* ignore */ }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 5000 },
    );
  }, []);

  const aqTip = currentAqi != null ? aqTips.find((t) => currentAqi <= t.maxAqi) ?? aqTips[aqTips.length - 1] : null;

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <Seo title="Tips Udara Bersih & Jalan Sehat — Breeva" description="Tips praktis mengurangi paparan polusi: pilih rute hijau, waktu terbaik berjalan, dan cara kurangi jejak karbon harian." path="/eco-tips" />
      <PageHeader title="Eco Tips" onBack={() => navigate(-1)} />

      <div className="px-4 pt-4 pb-12 max-w-2xl mx-auto">
        <div className="relative h-[130px] mb-5">
          <AnimatePresence mode="popLayout">
            <SwipeableCard key={cardIdx} tip={tips[cardIdx % tips.length]} onDismiss={() => setCardIdx((i) => i + 1)} />
          </AnimatePresence>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
            {tips.map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === cardIdx % tips.length ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            ))}
          </div>
        </div>

        {aqTip && (() => {
          const AqIcon = aqTip.icon;
          return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-4 mb-5">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${aqTip.color}`}><AqIcon className="w-5 h-5" /></div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Berdasarkan udara sekitarmu{currentAqi != null ? ` (AQI ${currentAqi})` : ''}</p>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">{aqTip.title}</h3>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed ml-[52px]">{aqTip.body}</p>
            </motion.div>
          );
        })()}

        <div className="space-y-3">
          {tips.map((tip, i) => {
            const Icon = tip.icon;
            const isOpen = expandedIdx === i;
            return (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
                onClick={() => setExpandedIdx(isOpen ? null : i)}
                className="glass-card p-4 w-full text-left"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tip.color}`}><Icon className="w-5 h-5" /></div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex-1">{tip.title}</h3>
                  <ChevronLeft className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : '-rotate-90'}`} />
                </div>
                {isOpen && (
                  <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="text-xs text-gray-500 dark:text-gray-400 mt-3 ml-[52px] leading-relaxed">
                    {tip.body}
                  </motion.p>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
