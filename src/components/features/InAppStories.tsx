import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Leaf, Wind, Footprints, Gift, Sparkles, type LucideIcon } from 'lucide-react';
import { CO2_GRAMS_PER_KM, TREE_KG_CO2_PER_YEAR } from '../../lib/metrics';

interface Story {
  id: string;
  title: string;
  icon: LucideIcon;
  gradient: string;
  slides: { heading: string; body: string; emoji: string }[];
}

const stories: Story[] = [
  {
    id: 'air-quality',
    title: 'Kualitas udara',
    icon: Wind,
    gradient: 'from-sky-400 to-cyan-500',
    slides: [
      { heading: 'Membaca ISPU', body: 'ISPU adalah indeks kualitas udara resmi Indonesia. Makin kecil makin baik; 0-50 Baik.', emoji: '🌬️' },
      { heading: 'Asap kendaraan', body: 'Asap kendaraan paling pekat di tepi jalan ramai dan pada jam sibuk. Gang di sebelahnya sering jauh lebih bersih.', emoji: '🚗' },
      { heading: 'Rute paling sedikit asap', body: 'Breeva membandingkan asap kendaraan di sepanjang tiap rute dan menulis seberapa yakin perkiraannya.', emoji: '🗺️' },
    ],
  },
  {
    id: 'eco-tips',
    title: 'Tips hijau',
    icon: Leaf,
    gradient: 'from-emerald-400 to-green-500',
    slides: [
      { heading: 'Setiap langkah dihitung', body: `Breeva menghitung ${CO2_GRAMS_PER_KM} g CO₂ yang tidak keluar untuk setiap km yang kamu jalani, dibanding naik kendaraan.`, emoji: '👣' },
      { heading: 'Setara pohon', body: `Di profil, CO₂ itu dibandingkan dengan serapan satu pohon, ${TREE_KG_CO2_PER_YEAR} kg CO₂ per tahun.`, emoji: '🌳' },
    ],
  },
  {
    id: 'rewards',
    title: 'Hadiah',
    icon: Gift,
    gradient: 'from-amber-400 to-yellow-500',
    slides: [
      { heading: 'Poin dari berjalan', body: 'Setiap jalan kaki yang selesai memberi EcoPoin; misi harian memberi tambahan.', emoji: '🎯' },
      { heading: 'Tukar di merchant', body: 'EcoPoin ditukar dengan voucher merchant mitra. Merchant yang tampil sekarang masih data contoh.', emoji: '🛍️' },
    ],
  },
  {
    id: 'walking',
    title: 'Jalan kaki',
    icon: Footprints,
    gradient: 'from-primary-400 to-primary-600',
    slides: [
      { heading: '30 menit sehari', body: 'WHO menganjurkan sedikitnya 150 menit aktivitas sedang per pekan, misalnya jalan kaki 30 menit, 5 hari.', emoji: '❤️' },
      { heading: 'Lihat dampakmu', body: 'Profil menampilkan CO₂ yang dihemat, kalori, dan setara pohon dari jalanmu.', emoji: '📊' },
    ],
  },
  {
    id: 'new-features',
    title: 'Baru',
    icon: Sparkles,
    gradient: 'from-purple-400 to-pink-500',
    slides: [
      { heading: 'Peta aktivitas', body: 'Profil menampilkan hari-hari kamu berjalan; satu kotak satu hari.', emoji: '📅' },
      { heading: 'Hari beruntun', body: 'Jalan kaki setiap hari menambah hari beruntun dan bonus EcoPoin.', emoji: '🔥' },
    ],
  },
];

function StoryCircle({ story, viewed, onClick }: { story: Story; viewed: boolean; onClick: () => void }) {
  const Icon = story.icon;
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
      <div className={`w-14 h-14 rounded-full p-[2px] bg-gradient-to-br ${viewed ? 'from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700' : story.gradient}`}>
        <div className="w-full h-full rounded-full bg-white dark:bg-gray-900 flex items-center justify-center">
          <Icon className="w-5 h-5 text-gray-700 dark:text-gray-300" strokeWidth={2} />
        </div>
      </div>
      <span className="text-[10px] text-gray-600 dark:text-gray-400 truncate w-full text-center font-medium">
        {story.title}
      </span>
    </button>
  );
}

function StoryViewer({ story, onClose, onNext, onPrev, hasNext, hasPrev }: {
  story: Story;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}) {
  const [slideIdx, setSlideIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slide = story.slides[slideIdx];

  const advance = useCallback(() => {
    if (slideIdx < story.slides.length - 1) {
      setSlideIdx(i => i + 1);
    } else if (hasNext) {
      onNext();
    } else {
      onClose();
    }
  }, [slideIdx, story.slides.length, hasNext, onNext, onClose]);

  useEffect(() => {
    timerRef.current = setTimeout(advance, 5000);
    return () => clearTimeout(timerRef.current);
  }, [slideIdx, advance]);

  const handleTap = (e: React.MouseEvent) => {
    const x = e.clientX;
    const w = window.innerWidth;
    clearTimeout(timerRef.current);
    if (x < w * 0.3) {
      if (slideIdx > 0) setSlideIdx(i => i - 1);
      else if (hasPrev) onPrev();
    } else {
      advance();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={handleTap}
    >
      {/* Progress bars */}
      <div className="absolute top-3 left-3 right-3 flex gap-1">
        {story.slides.map((_, i) => (
          <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-white rounded-full"
              initial={{ width: i < slideIdx ? '100%' : '0%' }}
              animate={{ width: i < slideIdx ? '100%' : i === slideIdx ? '100%' : '0%' }}
              transition={i === slideIdx ? { duration: 5, ease: 'linear' } : { duration: 0 }}
            />
          </div>
        ))}
      </div>

      {/* Close */}
      <button aria-label="Tutup"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-8 right-3 z-10 text-white/80 hover:text-white p-1"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Story title */}
      <div className="absolute top-8 left-3 flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${story.gradient} flex items-center justify-center`}>
          <story.icon className="w-4 h-4 text-white" />
        </div>
        <span className="text-white text-sm font-semibold">{story.title}</span>
      </div>

      {/* Slide content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={slideIdx}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="px-8 text-center max-w-sm"
        >
          <div className="text-6xl mb-6">{slide.emoji}</div>
          <h2 className="text-2xl font-bold text-white mb-3">{slide.heading}</h2>
          <p className="text-sm text-white/80 leading-relaxed">{slide.body}</p>
        </motion.div>
      </AnimatePresence>

      {/* Nav hints */}
      {hasPrev && slideIdx === 0 && (
        <ChevronLeft className="absolute left-2 top-1/2 -translate-y-1/2 w-6 h-6 text-white/30" />
      )}
      {(hasNext || slideIdx < story.slides.length - 1) && (
        <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 text-white/30" />
      )}
    </motion.div>
  );
}

export default function InAppStories() {
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('breeva_viewed_stories') || '[]'));
    } catch { return new Set(); }
  });
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const markViewed = (id: string) => {
    setViewedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('breeva_viewed_stories', JSON.stringify([...next]));
      return next;
    });
  };

  const openStory = (idx: number) => {
    setActiveIdx(idx);
    markViewed(stories[idx].id);
  };

  return (
    <>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
        {stories.map((story, i) => (
          <StoryCircle
            key={story.id}
            story={story}
            viewed={viewedIds.has(story.id)}
            onClick={() => openStory(i)}
          />
        ))}
      </div>

      <AnimatePresence>
        {activeIdx !== null && (
          <StoryViewer
            story={stories[activeIdx]}
            onClose={() => setActiveIdx(null)}
            onNext={() => {
              const next = activeIdx + 1;
              if (next < stories.length) {
                setActiveIdx(next);
                markViewed(stories[next].id);
              } else {
                setActiveIdx(null);
              }
            }}
            onPrev={() => {
              const prev = activeIdx - 1;
              if (prev >= 0) setActiveIdx(prev);
            }}
            hasNext={activeIdx < stories.length - 1}
            hasPrev={activeIdx > 0}
          />
        )}
      </AnimatePresence>
    </>
  );
}
