import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Star, Send } from 'lucide-react';

interface PostWalkRatingProps {
  onSubmit: (rating: number, photo?: File) => void;
  onSkip: () => void;
}

const ratingOptions = [
  { value: 1, emoji: '😷', label: 'Very Bad' },
  { value: 2, emoji: '😐', label: 'Bad' },
  { value: 3, emoji: '🙂', label: 'Okay' },
  { value: 4, emoji: '😊', label: 'Good' },
  { value: 5, emoji: '🤩', label: 'Excellent' },
];

export default function PostWalkRating({ onSubmit, onSkip }: PostWalkRatingProps) {
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-3xl overflow-hidden bg-white dark:bg-gray-900/90 backdrop-blur-2xl border border-gray-200 dark:border-gray-700/30 shadow-2xl p-6 max-w-sm w-full"
    >
      <h3 className="text-lg font-bold text-gray-900 dark:text-white text-center mb-2">
        How was the air quality?
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-5">
        Help others by rating the air on your walk
      </p>

      {/* Emoji rating scale */}
      <div className="flex justify-center gap-2 sm:gap-3 mb-6">
        {ratingOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setSelectedRating(option.value)}
            className={`
              flex flex-col items-center gap-1 p-2.5 rounded-2xl transition-all
              ${selectedRating === option.value
                ? 'bg-primary-100 dark:bg-primary-900/30 scale-110 ring-2 ring-primary-400/50'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800/50'
              }
            `}
          >
            <span className="text-2xl">{option.emoji}</span>
            <span className={`text-[10px] font-medium ${
              selectedRating === option.value
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
              {option.label}
            </span>
          </button>
        ))}
      </div>

      {/* Photo upload (optional) */}
      <AnimatePresence>
        {selectedRating && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <label className="flex items-center gap-2.5 rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-950/50 px-4 py-3 cursor-pointer mb-4 hover:bg-gray-100 dark:bg-gray-800/50 dark:hover:bg-gray-800/50 transition-colors">
              <Camera size={18} className="text-gray-400 dark:text-gray-500" />
              <span className="text-sm text-gray-600 dark:text-gray-300 flex-1 truncate">
                {photo ? photo.name : 'Add a photo (optional)'}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setPhoto(e.target.files?.[0] || null)}
              />
            </label>

            <div className="flex items-center justify-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-4">
              <Star size={12} fill="currentColor" />
              <span>Earn +5 bonus points for rating!</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 py-3 text-sm text-gray-500 dark:text-gray-400 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800/50 transition"
        >
          Skip
        </button>
        <button
          onClick={() => selectedRating && onSubmit(selectedRating, photo || undefined)}
          disabled={!selectedRating}
          className={`
            flex-1 py-3 text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2
            ${selectedRating
              ? 'gradient-primary text-white shadow-lg shadow-primary-500/25 hover:shadow-xl'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            }
          `}
        >
          <Send size={14} />
          Submit
        </button>
      </div>
    </motion.div>
  );
}
