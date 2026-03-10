import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  MapPinPlus,
  Store,
  TreePine,
  AlertTriangle,
  Camera,
  Send,
  CheckCircle2,
  LocateFixed,
  Wind,
  Footprints,
} from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

type ReportType = 'missing_place' | 'eco_merchant' | 'green_space' | 'hazard';

const reportTypes: { type: ReportType; icon: React.ReactNode; label: string; description: string; color: string }[] = [
  {
    type: 'missing_place',
    icon: <MapPinPlus className="w-5 h-5" />,
    label: 'Missing Place',
    description: 'Report a place not on the map',
    color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
  },
  {
    type: 'eco_merchant',
    icon: <Store className="w-5 h-5" />,
    label: 'Eco Merchant',
    description: 'Suggest a sustainable business',
    color: 'text-primary-500 bg-primary-50 dark:bg-primary-900/20',
  },
  {
    type: 'green_space',
    icon: <TreePine className="w-5 h-5" />,
    label: 'Green Space',
    description: 'Report a park or green area',
    color: 'text-green-500 bg-green-50 dark:bg-green-900/20',
  },
  {
    type: 'hazard',
    icon: <AlertTriangle className="w-5 h-5" />,
    label: 'Air Quality Hazard',
    description: 'Report poor air quality zone',
    color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
  },
];

export default function ContributePage() {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<ReportType | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [placeDescription, setPlaceDescription] = useState('');
  const [placeCategory, setPlaceCategory] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);

  const handleGetLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCurrentCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        alert('Could not get your location');
      },
      { enableHighAccuracy: true }
    );
  };

  const handleSubmit = async () => {
    if (!selectedType || !placeName.trim()) return;

    setIsSubmitting(true);

    try {
      const { user } = useAuthStore.getState();

      // Submit air quality hazard reports to Supabase
      if (selectedType === 'hazard' && currentCoords && user) {
        await supabase.from('air_quality_reports').insert({
          user_id: user.id,
          lat: currentCoords.lat,
          lng: currentCoords.lng,
          aqi_rating: 4, // poor
          description: `${placeName.trim()} — ${placeDescription.trim()}`,
        });
      }

      // Store all contributions locally + as a backup
      const contribution = {
        id: crypto.randomUUID(),
        type: selectedType,
        name: placeName.trim(),
        description: placeDescription.trim(),
        category: placeCategory.trim(),
        coordinate: currentCoords,
        createdAt: new Date().toISOString(),
      };

      const contributions = JSON.parse(localStorage.getItem('breeva_contributions') || '[]');
      contributions.push(contribution);
      localStorage.setItem('breeva_contributions', JSON.stringify(contributions));
    } catch (err) {
      console.error('Submission error:', err);
    }

    setIsSubmitting(false);
    setIsSubmitted(true);
  };

  const handleReset = () => {
    setSelectedType(null);
    setPlaceName('');
    setPlaceDescription('');
    setPlaceCategory('');
    setIsSubmitted(false);
    setCurrentCoords(null);
  };

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Contribute</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12">
        {/* Success State */}
        {isSubmitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card p-8 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.2 }}
            >
              <CheckCircle2 className="w-16 h-16 text-primary-500 mx-auto mb-4" />
            </motion.div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Thank You!</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Your contribution helps make Breeva better for everyone.
            </p>
            <p className="text-xs text-primary-500 font-medium mb-6">
              +25 EcoPoints earned for contributing!
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-300"
              >
                Add Another
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 gradient-primary text-white py-3 rounded-xl text-sm font-semibold"
              >
                Back to Map
              </button>
            </div>
          </motion.div>
        ) : (
          <>
            {/* Description */}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Help make Breeva's map more complete and accurate. Your contributions improve eco-routing for everyone.
            </p>

            {/* VAYU Air Quality Contributor */}
            <div className="glass-card p-4 mb-5 border border-primary-200/50 dark:border-primary-800/30 bg-gradient-to-r from-primary-50/50 to-emerald-50/50 dark:from-primary-950/30 dark:to-emerald-950/30">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-emerald-500 flex items-center justify-center shadow-sm">
                  <Wind className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">VAYU Air Contributor</h4>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">Otomatis aktif saat kamu jalan</p>
                </div>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed mb-3">
                Setiap kali kamu berjalan dengan Breeva, data pergerakanmu (tanpa identitas) membantu membangun peta kualitas udara real-time untuk semua pengguna. Semakin sering kamu jalan, semakin akurat VAYU Engine.
              </p>
              <div className="flex items-center gap-4 text-[10px]">
                <div className="flex items-center gap-1 text-primary-600 dark:text-primary-400 font-medium">
                  <Footprints className="w-3 h-3" />
                  Tier 0: Auto-trace
                </div>
                <div className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
                  <CheckCircle2 className="w-3 h-3" />
                  Anonim & aman
                </div>
              </div>
            </div>

            {/* Report Type Selection */}
            {!selectedType && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">
                  What would you like to add?
                </h3>
                {reportTypes.map((type, i) => (
                  <motion.button
                    key={type.type}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => {
                      setSelectedType(type.type);
                      handleGetLocation();
                    }}
                    className="w-full glass-card p-4 flex items-center gap-4 text-left hover:shadow-md transition-shadow"
                  >
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${type.color}`}>
                      {type.icon}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{type.label}</h4>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{type.description}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}

            {/* Report Form */}
            {selectedType && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <button
                  onClick={() => setSelectedType(null)}
                  className="text-xs text-primary-500 font-medium"
                >
                  ← Change type
                </button>

                {/* Place Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                    Place Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Taman Kota Baru"
                    value={placeName}
                    onChange={e => setPlaceName(e.target.value)}
                    className="w-full bg-white dark:bg-gray-900/80 backdrop-blur-sm rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none border border-gray-200 dark:border-gray-700/50 focus:border-primary-500 transition"
                  />
                </div>

                {/* Category */}
                {(selectedType === 'missing_place' || selectedType === 'eco_merchant') && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                      Category
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(selectedType === 'eco_merchant'
                        ? ['Refill Station', 'Thrift Store', 'Vegan Restaurant', 'Repair Shop', 'Eco Products', 'Organic Market']
                        : ['Restaurant', 'Cafe', 'Shop', 'School', 'Mosque', 'Hospital', 'Park', 'Other']
                      ).map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setPlaceCategory(cat)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            placeCategory === cat
                              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                    Description (optional)
                  </label>
                  <textarea
                    placeholder="Any details that would help..."
                    value={placeDescription}
                    onChange={e => setPlaceDescription(e.target.value)}
                    rows={3}
                    className="w-full bg-white dark:bg-gray-900/80 backdrop-blur-sm rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none border border-gray-200 dark:border-gray-700/50 focus:border-primary-500 transition resize-none"
                  />
                </div>

                {/* Location */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                    Location
                  </label>
                  <button
                    onClick={handleGetLocation}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition w-full ${
                      currentCoords
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    <LocateFixed className="w-4 h-4" />
                    {currentCoords
                      ? `📍 ${currentCoords.lat.toFixed(4)}, ${currentCoords.lng.toFixed(4)}`
                      : 'Use Current Location'
                    }
                  </button>
                </div>

                {/* Photo placeholder */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                    Photo (optional)
                  </label>
                  <button className="flex flex-col items-center gap-2 w-full py-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-primary-300 hover:text-primary-500 transition">
                    <Camera className="w-6 h-6" />
                    <span className="text-xs font-medium">Tap to add photo</span>
                  </button>
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={!placeName.trim() || isSubmitting}
                  className="w-full gradient-primary text-white py-3.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Submit Contribution
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
