import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, MapPin, Home, Briefcase, Heart, Trash2, Navigation, Plus, Search, Share2, Clock,
  Coffee, UtensilsCrossed, TreePine, Dumbbell, GraduationCap, Cross,
  Church, ShoppingBag, Landmark, Hotel, Bus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSavedPlacesStore } from '../stores/savedPlacesStore';
import { useAuthStore } from '../stores/authStore';
import BottomNavigation from '../components/layout/BottomNavigation';
import EmptyState from '../components/ui/EmptyState';
import type { SavedPlace } from '../types';

const CATEGORY_CONFIG: Record<string, { icon: LucideIcon; color: string; gradient: string; label: string }> = {
  home:      { icon: Home,             color: 'bg-blue-50 dark:bg-blue-500/10 text-blue-500',      gradient: 'from-blue-500 to-blue-600',      label: 'Home' },
  work:      { icon: Briefcase,        color: 'bg-amber-50 dark:bg-amber-500/10 text-amber-500',    gradient: 'from-amber-500 to-amber-600',    label: 'Work' },
  favorite:  { icon: Heart,            color: 'bg-rose-50 dark:bg-rose-500/10 text-rose-500',       gradient: 'from-rose-500 to-rose-600',      label: 'Favorite' },
  food:      { icon: UtensilsCrossed,  color: 'bg-orange-50 dark:bg-orange-500/10 text-orange-500', gradient: 'from-orange-500 to-orange-600',  label: 'Food' },
  cafe:      { icon: Coffee,           color: 'bg-yellow-50 dark:bg-yellow-500/10 text-yellow-600', gradient: 'from-yellow-500 to-yellow-600',  label: 'Cafe' },
  park:      { icon: TreePine,         color: 'bg-green-50 dark:bg-green-500/10 text-green-500',    gradient: 'from-green-500 to-green-600',    label: 'Park' },
  gym:       { icon: Dumbbell,         color: 'bg-violet-50 dark:bg-violet-500/10 text-violet-500', gradient: 'from-violet-500 to-violet-600',  label: 'Gym' },
  school:    { icon: GraduationCap,    color: 'bg-sky-50 dark:bg-sky-500/10 text-sky-500',          gradient: 'from-sky-500 to-sky-600',        label: 'School' },
  hospital:  { icon: Cross,            color: 'bg-red-50 dark:bg-red-500/10 text-red-500',          gradient: 'from-red-500 to-red-600',        label: 'Hospital' },
  mosque:    { icon: Landmark,         color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600', gradient: 'from-emerald-500 to-emerald-600', label: 'Mosque' },
  church:    { icon: Church,           color: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500', gradient: 'from-indigo-500 to-indigo-600',  label: 'Church' },
  shop:      { icon: ShoppingBag,      color: 'bg-pink-50 dark:bg-pink-500/10 text-pink-500',       gradient: 'from-pink-500 to-pink-600',      label: 'Shop' },
  landmark:  { icon: Landmark,         color: 'bg-teal-50 dark:bg-teal-500/10 text-teal-500',       gradient: 'from-teal-500 to-teal-600',      label: 'Landmark' },
  hotel:     { icon: Hotel,            color: 'bg-purple-50 dark:bg-purple-500/10 text-purple-500', gradient: 'from-purple-500 to-purple-600',  label: 'Hotel' },
  transport: { icon: Bus,              color: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-500',       gradient: 'from-cyan-500 to-cyan-600',      label: 'Transport' },
  custom:    { icon: MapPin,           color: 'bg-primary-50 dark:bg-primary-500/10 text-primary-500', gradient: 'from-primary-500 to-primary-600', label: 'Custom' },
};

function getCategoryConfig(cat: string) {
  return CATEGORY_CONFIG[cat] ?? CATEGORY_CONFIG.custom;
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

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
    navigate('/home', { state: { destination: place.coordinate, destinationName: place.name } });
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

  const categories = ['all', ...Object.keys(CATEGORY_CONFIG)];

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
          {categories.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const CatIcon = cfg?.icon;
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition capitalize ${
                  filter === cat
                    ? 'gradient-primary text-white shadow-sm'
                    : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-400'
                }`}
              >
                {CatIcon && <CatIcon className="w-3.5 h-3.5" />}
                {cfg?.label ?? cat}
              </button>
            );
          })}
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
                <div className="flex gap-2 mb-3 overflow-x-auto scrollbar-hide pb-1">
                  {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                    const CatIcon = cfg.icon;
                    return (
                      <button
                        key={key}
                        onClick={() => setNewCategory(key as SavedPlace['category'])}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                          newCategory === key
                            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        <CatIcon className="w-3.5 h-3.5" />
                        {cfg.label}
                      </button>
                    );
                  })}
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
            className="space-y-3"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          >
            {filteredPlaces.map((place) => {
              const timeAgo = getTimeAgo(place.createdAt);
              return (
                <motion.div
                  key={place.id}
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                  className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm overflow-hidden"
                >
                  {/* Top accent bar */}
                  <div className={`h-1 bg-gradient-to-r ${getCategoryConfig(place.category).gradient}`} />

                  <div className="p-4">
                    <div className="flex items-start gap-3.5">
                      {/* Category icon */}
                      {(() => {
                        const cfg = getCategoryConfig(place.category);
                        const CatIcon = cfg.icon;
                        return (
                          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${cfg.color}`}>
                            <CatIcon className="w-5 h-5" />
                          </div>
                        );
                      })()}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{place.name}</h4>
                          <span className={`shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-md ${getCategoryConfig(place.category).color}`}>
                            {getCategoryConfig(place.category).label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {place.address || `${place.coordinate.lat.toFixed(4)}, ${place.coordinate.lng.toFixed(4)}`}
                        </p>
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                          <Clock className="w-3 h-3" />
                          <span>Saved {timeAgo}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/50">
                      <button
                        onClick={() => handleNavigate(place)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 text-xs font-semibold hover:bg-primary-100 dark:hover:bg-primary-500/20 transition"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        Navigate
                      </button>
                      <button
                        onClick={() => handleSharePlace(place)}
                        className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        Share
                      </button>
                      <button
                        onClick={() => removePlace(place.id)}
                        className="flex items-center justify-center p-2 rounded-xl text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
