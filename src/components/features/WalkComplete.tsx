import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { MapPin, Clock, Leaf, Flame, Sparkles, Star, Map, ChevronRight, Wind, Shield } from 'lucide-react';
import type { WalkSession, ExposureResult } from '../../types';
import PostWalkRating from './PostWalkRating';

interface WalkCompleteProps {
  session: WalkSession;
  onClose: () => void;
  exposureResult?: ExposureResult | null;
}

export default function WalkComplete({ session, onClose, exposureResult }: WalkCompleteProps) {
  const navigate = useNavigate();
  const [showRating, setShowRating] = useState(false);
  const [rated, setRated] = useState(false);

  const distKm = (session.distance_meters / 1000).toFixed(2);
  const durMin = Math.floor(session.duration_seconds / 60);
  const co2Saved = (session.distance_meters * 0.00021).toFixed(2);
  const calories = Math.round(session.distance_meters * 0.05);

  const handleRatingSubmit = (rating: number, _photo?: File) => {
    console.log('AQI Rating:', rating);
    setRated(true);
    setShowRating(false);
  };

  if (showRating) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <PostWalkRating
          onSubmit={handleRatingSubmit}
          onSkip={() => setShowRating(false)}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="rounded-3xl overflow-hidden bg-white dark:bg-gray-900/90 backdrop-blur-2xl border border-gray-200 dark:border-gray-700/30 shadow-2xl p-6 max-w-sm w-full"
      >
        {/* Celebration header */}
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.2 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-primary-500 mb-3 shadow-lg shadow-primary-500/30"
          >
            <Sparkles size={28} className="text-white" />
          </motion.div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Walk Complete!
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Great job making a difference!
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <StatCard icon={<MapPin size={16} />} label="Distance" value={`${distKm} km`} color="text-blue-500" bg="bg-blue-50 dark:bg-blue-500/10" />
          <StatCard icon={<Clock size={16} />} label="Duration" value={`${durMin} min`} color="text-violet-500" bg="bg-violet-50 dark:bg-violet-500/10" />
          <StatCard icon={<Leaf size={16} />} label="CO₂ Saved" value={`${co2Saved} kg`} color="text-emerald-500" bg="bg-emerald-50 dark:bg-emerald-500/10" />
          <StatCard icon={<Flame size={16} />} label="Calories" value={`${calories}`} color="text-orange-500" bg="bg-orange-50 dark:bg-orange-500/10" />
        </div>

        {/* VAYU Exposure card */}
        {exposureResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-5 rounded-2xl border border-gray-200 dark:border-gray-700/30 overflow-hidden"
          >
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
              <Wind size={14} className="text-blue-500" />
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Air Exposure</span>
              <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                exposureResult.health_risk_level === 'low' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                exposureResult.health_risk_level === 'moderate' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                exposureResult.health_risk_level === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              }`}>
                {exposureResult.health_risk_level === 'low' ? 'Risiko Rendah' :
                 exposureResult.health_risk_level === 'moderate' ? 'Risiko Sedang' :
                 exposureResult.health_risk_level === 'high' ? 'Risiko Tinggi' : 'Risiko Sangat Tinggi'}
              </span>
            </div>
            <div className="px-4 py-3 grid grid-cols-2 gap-3">
              <div className="text-center">
                <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                  {exposureResult.cigarette_equivalent.toFixed(2)}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">🚬 Setara rokok</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                  {exposureResult.avg_pm25.toFixed(1)}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">µg/m³ PM2.5 avg</p>
              </div>
            </div>
            {exposureResult.cigarette_equivalent < 0.5 && (
              <div className="px-4 pb-3">
                <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
                  <Shield size={10} />
                  <span>Paparan udara aman untuk aktivitas ini! 🎉</span>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Points earned */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="gradient-primary rounded-2xl p-4 text-center mb-5"
        >
          <p className="text-white/80 text-xs mb-1">EcoPoints Earned</p>
          <div className="flex items-center justify-center gap-2">
            <Star size={22} className="text-amber-300" fill="currentColor" />
            <motion.span
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', delay: 0.6 }}
              className="text-3xl font-bold text-white tabular-nums"
            >
              +{session.eco_points_earned}
            </motion.span>
          </div>
          {rated && (
            <p className="text-white/80 text-xs mt-1">+5 bonus for rating!</p>
          )}
        </motion.div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {!rated && (
            <button
              onClick={() => setShowRating(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-500/10 px-4 py-3 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors"
            >
              <Leaf size={16} />
              Rate Air Quality (+5 pts)
            </button>
          )}
          <button
            onClick={() => { onClose(); navigate('/'); }}
            className="flex items-center justify-center gap-2 gradient-primary text-white text-sm font-semibold py-3 rounded-xl shadow-lg shadow-primary-500/25 hover:shadow-xl transition-all"
          >
            <Map size={16} />
            Back to Map
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => { onClose(); navigate('/profile/history'); }}
            className="text-sm text-gray-500 dark:text-gray-400 py-2 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-200 dark:text-gray-700 transition"
          >
            View Walk History
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-3 text-center`}>
      <div className={`inline-flex ${color} mb-1`}>{icon}</div>
      <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
      <p className="text-[10px] text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
