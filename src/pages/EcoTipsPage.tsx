import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Leaf, Wind, Footprints, Droplets, TreePine, AlertTriangle } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';

const tips = [
  {
    icon: Leaf,
    title: 'Walk to Save CO₂',
    body: 'Walking 1 km saves ~170g CO₂ compared to driving. That adds up to over 60 kg per year for daily commuters!',
    color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20',
  },
  {
    icon: Wind,
    title: 'Choose Cleaner Routes',
    body: "Routes near parks and green spaces have up to 60% less air pollution. Breeva's VAYU Engine finds the cleanest path for you.",
    color: 'text-sky-500 bg-sky-50 dark:bg-sky-900/20',
  },
  {
    icon: Footprints,
    title: '30 Minutes of Walking',
    body: "Walking 30 minutes daily reduces the risk of heart disease by 20% and boosts your mood significantly. It's free healthcare!",
    color: 'text-primary-500 bg-primary-50 dark:bg-primary-900/20',
  },
  {
    icon: TreePine,
    title: 'Trees Are Air Purifiers',
    body: 'A single tree can absorb 22 kg of CO₂ per year and filter harmful particulates. Walk near trees whenever possible.',
    color: 'text-green-500 bg-green-50 dark:bg-green-900/20',
  },
  {
    icon: Droplets,
    title: 'Save Water Too',
    body: 'Cars use ~3.8 liters of water per kilometer (manufacturing + washing). By walking, you conserve a hidden resource.',
    color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
  },
  {
    icon: Leaf,
    title: 'Eco-Points = Real Rewards',
    body: 'Use your EcoPoints at sustainable merchants for discounts on food, drinks, and eco-products. Walking literally pays off!',
    color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
  },
  {
    icon: Wind,
    title: 'Peak Traffic = Peak Pollution',
    body: 'Air quality is worst during rush hours (7-9 AM and 5-7 PM). Try to schedule your walks in the mornings or evenings for cleaner air.',
    color: 'text-rose-500 bg-rose-50 dark:bg-rose-900/20',
  },
  {
    icon: Footprints,
    title: 'Walking Meetings',
    body: 'Suggest walking meetings at work! Studies show walking boosts creative thinking by 60%. Good for you AND your projects.',
    color: 'text-violet-500 bg-violet-50 dark:bg-violet-900/20',
  },
];

const aqTips = [
  {
    condition: 'good',
    maxAqi: 50,
    icon: Leaf,
    title: 'Air Quality is Great!',
    body: 'AQ index is below 50 — perfect for outdoor walks. Take advantage and go for a longer walk today!',
    color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20',
  },
  {
    condition: 'moderate',
    maxAqi: 100,
    icon: Wind,
    title: 'Moderate Air Quality',
    body: 'AQ index is 51-100. Walking is still safe for most people. Avoid heavy exercise near busy roads.',
    color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
  },
  {
    condition: 'poor',
    maxAqi: 999,
    icon: AlertTriangle,
    title: 'Poor Air Quality Alert',
    body: 'AQ index is above 100. Consider shorter walks, wear a mask, and stick to routes through parks and green spaces.',
    color: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  },
];

export default function EcoTipsPage() {
  const navigate = useNavigate();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [currentAqi, setCurrentAqi] = useState<number | null>(null);

  // Fetch AQI for current location
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`/api/vayu/aqi?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          if (res.ok) {
            const data = await res.json();
            setCurrentAqi(data.aqi ?? data.value ?? null);
          }
        } catch { /* ignore */ }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  // Daily tip rotation based on date
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const tipOfDay = tips[dayOfYear % tips.length];
  const TipOfDayIcon = tipOfDay.icon;

  // Get relevant AQ tip
  const aqTip = currentAqi != null ? aqTips.find(t => currentAqi <= t.maxAqi) || aqTips[aqTips.length - 1] : null;

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Eco Tips</h1>
        <div className="w-6" />
      </div>

      <div className="px-4 pt-4 pb-12 max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 mb-5"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tipOfDay.color}`}>
              <TipOfDayIcon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider">Tip of the Day</p>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{tipOfDay.title}</h2>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed ml-[52px]">
            {tipOfDay.body}
          </p>
        </motion.div>

        {/* AQ-Based Tip */}
        {aqTip && (() => {
          const AqIcon = aqTip.icon;
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-card p-4 mb-5 border border-gray-200/50 dark:border-gray-700/30"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${aqTip.color}`}>
                  <AqIcon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Based on Local AQ{currentAqi != null ? ` (AQI: ${currentAqi})` : ''}</p>
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
                transition={{ delay: i * 0.04 }}
                onClick={() => setExpandedIdx(isOpen ? null : i)}
                className="glass-card p-4 w-full text-left"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tip.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex-1">{tip.title}</h3>
                  <ChevronLeft
                    className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : '-rotate-90'}`}
                  />
                </div>
                {isOpen && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="text-xs text-gray-500 dark:text-gray-400 mt-3 ml-[52px] leading-relaxed"
                  >
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
