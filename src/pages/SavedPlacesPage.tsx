import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, MapPin, Home, Briefcase, Heart, Trash2, Navigation, Plus, Search, Share2 } from 'lucide-react';
import { useSavedPlacesStore } from '../stores/savedPlacesStore';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';
import EmptyState from '../components/ui/EmptyState';
import type { SavedPlace } from '../types';

const categoryIcons: Record<string, React.ReactNode> = {
  home: <Home className="w-4 h-4 text-blue-500" />,
  work: <Briefcase className="w-4 h-4 text-amber-500" />,
  favorite: <Heart className="w-4 h-4 text-rose-500" />,
  custom: <MapPin className="w-4 h-4 text-primary-500" />,
};

const categoryColors: Record<string, string> = {
  home: 'bg-blue-50 dark:bg-blue-900/20',
  work: 'bg-amber-50 dark:bg-amber-900/20',
  favorite: 'bg-rose-50 dark:bg-rose-900/20',
  custom: 'bg-primary-50 dark:bg-primary-900/20',
};

export default function SavedPlacesPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { places, removePlace, addPlace, fetchCloudPlaces } = useSavedPlacesStore();
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<SavedPlace['category']>('favorite');

  // Sync from cloud on mount
  useEffect(() => {
    if (user) fetchCloudPlaces(user.id);
  }, [user, fetchCloudPlaces]);

  const filteredPlaces = places.filter(p => {
    if (filter !== 'all' && p.category !== filter) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleSharePlace = async (place: SavedPlace) => {
    const text = `📍 ${place.name}\n📌 ${place.address || `${place.coordinate.lat.toFixed(4)}, ${place.coordinate.lng.toFixed(4)}`}\n\nShared via Breeva — eco-walk app\nhttps://breeva.site`;
    try {
      if (navigator.share) {
        await navigator.share({ title: place.name, text });
      } else {
        await navigator.clipboard.writeText(text);
        alert('Place info copied to clipboard!');
      }
    } catch { /* cancelled */ }
  };

  const handleNavigate = (place: SavedPlace) => {
    // Navigate to home and set destination
    navigate('/', { state: { destination: place.coordinate, destinationName: place.name } });
  };

  const handleAddCurrentLocation = () => {
    if (!newName.trim()) return;
    // Get current position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        addPlace(newName.trim(), {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }, newCategory);
        setNewName('');
        setShowAddForm(false);
      },
      () => {
        alert('Could not get your current location');
      },
      { enableHighAccuracy: true }
    );
  };

  const categories = ['all', 'home', 'work', 'favorite', 'custom'];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Saved Places</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="p-1.5 rounded-lg text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12">
        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl glass-card mb-4">
          <Search className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Search saved places..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition capitalize ${
                filter === cat
                  ? 'gradient-primary text-white shadow-sm'
                  : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-400'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Add Place Form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="glass-card p-4 mb-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Save Current Location</h3>
                <input
                  type="text"
                  placeholder="Place name (e.g. Home, Gym, Office)"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none border border-gray-200 dark:border-gray-700/50 focus:border-primary-500 mb-3"
                />
                <div className="flex gap-2 mb-3">
                  {(['home', 'work', 'favorite', 'custom'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setNewCategory(cat)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition capitalize ${
                        newCategory === cat
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {categoryIcons[cat]}
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleAddCurrentLocation}
                  disabled={!newName.trim()}
                  className="w-full py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Location
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Saved Places List */}
        {filteredPlaces.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No saved places"
            description="Save your favourite locations for quick navigation"
            actionLabel="Add First Place"
            onAction={() => setShowAddForm(true)}
          />
        ) : (
          <motion.div
            className="space-y-2"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          >
            {filteredPlaces.map((place) => (
              <motion.div
                key={place.id}
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                className="glass-card p-3.5 flex items-center gap-3"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${categoryColors[place.category]}`}>
                  {categoryIcons[place.category]}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{place.name}</h4>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                    {place.address || `${place.coordinate.lat.toFixed(4)}, ${place.coordinate.lng.toFixed(4)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSharePlace(place)}
                    className="p-2 rounded-lg text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition"
                    title="Share"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleNavigate(place)}
                    className="p-2 rounded-lg text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition"
                    title="Navigate"
                  >
                    <Navigation className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removePlace(place.id)}
                    className="p-2 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
