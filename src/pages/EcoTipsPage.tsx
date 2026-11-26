import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { ChevronLeft, Leaf, Wind, Footprints, TreePine, AlertTriangle } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import PageHeader from '../components/ui/PageHeader';
import { Seo } from '../components/Seo';

const tips = [
  { icon: Leaf, title: 'Jalan Kaki Hemat CO₂', body: 'Breeva menghitung 120 g CO₂ yang tidak keluar untuk setiap km yang kamu jalani, dibanding naik kendaraan.', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' },
  { icon: Wind, title: 'Pilih Rute Lebih Bersih', body: 'Asap kendaraan paling pekat di tepi jalan ramai. Rute paling sedikit asap di Breeva menghindari jalan ramai bila tambahan waktunya kecil.', color: 'text-sky-500 bg-sky-50 dark:bg-sky-900/20' },
  { icon: Footprints, title: '30 Menit Jalan Kaki', body: 'WHO menganjurkan sedikitnya 150 menit aktivitas sedang per pekan, misalnya jalan kaki 30 menit, 5 hari.', color: 'text-primary-500 bg-primary-50 dark:bg-primary-900/20' },
  { icon: TreePine, title: 'Pohon = Penyaring Udara', body: 'Breeva memakai 22 kg CO₂ per tahun sebagai serapan satu pohon untuk angka “setara pohon” di profilmu.', color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
  { icon: Leaf, title: 'EcoPoin dan hadiah', body: 'Poin dari jalan kaki dan misi bisa ditukar dengan voucher merchant mitra. Merchant yang tampil sekarang masih data contoh.', color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
  { icon: Wind, title: 'Jam Sibuk = Polusi Puncak', body: 'Asap kendaraan paling tinggi pada jam sibuk. Bila bisa, jalan di luar jam itu, atau lewat gang di samping jalan ramai.', color: 'text-rose-500 bg-rose-50 dark:bg-rose-900/20' },
  { icon: Footprints, title: 'Rapat Sambil Jalan', body: 'Coba ngobrol atau rapat sambil berjalan. Banyak orang merasa lebih segar berpikir sambil melangkah.', color: 'text-violet-500 bg-violet-50 dark:bg-violet-900/20' },
];

const aqTips = [
  { maxAqi: 50, icon: Leaf, title: 'Udara Sedang Bersih!', body: 'Udara baik untuk jalan kaki. Manfaatkan, jalan lebih jauh hari ini.', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' },
  { maxAqi: 100, icon: Wind, title: 'Udara Sedang', body: 'Jalan kaki masih baik untuk kebanyakan orang. Kelompok sensitif: hindari olahraga berat dekat jalan ramai.', color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
  { maxAqi: 999, icon: AlertTriangle, title: 'Awas, Udara Buruk', body: 'Pertimbangkan jalan lebih singkat, pakai masker, dan pilih rute paling sedikit asap.', color: 'text-red-500 bg-red-50 dark:bg-red-900/20' },
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
      <PageHeader title="Tips hijau" onBack={() => navigate(-1)} />

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
