import { motion } from 'framer-motion';
import { Share2, Footprints, Leaf, Flame } from 'lucide-react';

const fmt1 = (x: number) => x.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface WeeklySummaryCardProps {
  distanceKm: number;
  walks: number;
  co2Kg: number;
  streak: number;
  pointsEarned: number;
}

export default function WeeklySummaryCard({ distanceKm, walks, co2Kg, streak, pointsEarned }: WeeklySummaryCardProps) {
  const handleShare = async () => {
    const text = `Pekan ini di Breeva\n${fmt1(distanceKm)} km dalam ${walks} jalan\n${fmt1(co2Kg)} kg CO₂ dihemat\n${streak} hari beruntun\nsaldo ${pointsEarned.toLocaleString('id-ID')} EcoPoin\n\nbreeva.site`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Pekan ini di Breeva', text });
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch { /* cancelled */ }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative rounded-2xl overflow-hidden"
    >
      <div className="bg-gradient-to-br from-primary-500 via-emerald-500 to-teal-600 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-white/80 uppercase tracking-wider">Pekan ini</h3>
          <button aria-label="Bagikan"
            onClick={handleShare}
            className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition text-white"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3">
            <Footprints className="w-4 h-4 text-white/70 mb-1" />
            <div className="text-xl font-bold text-white tabular-nums">{fmt1(distanceKm)}<span className="text-sm ml-0.5">km</span></div>
            <div className="text-[10px] text-white/60">{walks} jalan</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3">
            <Leaf className="w-4 h-4 text-white/70 mb-1" />
            <div className="text-xl font-bold text-white tabular-nums">{fmt1(co2Kg)}<span className="text-sm ml-0.5">kg</span></div>
            <div className="text-[10px] text-white/60">CO₂ dihemat</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3">
            <Flame className="w-4 h-4 text-white/70 mb-1" />
            <div className="text-xl font-bold text-white tabular-nums">{streak}</div>
            <div className="text-[10px] text-white/60">hari beruntun</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3">
            <span className="text-sm text-white/70 mb-1 block">⭐</span>
            <div className="text-xl font-bold text-white tabular-nums">{pointsEarned.toLocaleString('id-ID')}</div>
            <div className="text-[10px] text-white/60">saldo poin</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
