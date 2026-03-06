import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, MapPin, Clock, Loader2 } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import type { POI } from '../../lib/poi-api';

interface SearchBarProps {
  onPlaceSelect?: (poi: POI) => void;
}

export default function SearchBar({ onPlaceSelect }: SearchBarProps) {
  const {
    searchQuery,
    setSearchQuery,
    search,
    searchResults,
    isSearching,
    recentSearches,
    clearSearch,
    setDestination,
    userLocation,
  } = useMapStore();

  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleInputChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void search(value);
      }, 300);
    },
    [setSearchQuery, search]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSelect = (result: typeof searchResults[number]) => {
    // If we have a Foursquare place and onPlaceSelect, open detail sheet first
    if (result.fsqId && onPlaceSelect) {
      const poi: POI = {
        id: `fsq-${result.fsqId}`,
        name: result.name,
        category: result.category || 'Place',
        coordinate: result.coordinate,
        distance: result.distance,
        address: result.address,
      };
      onPlaceSelect(poi);
    } else {
      setDestination(result.coordinate, result.name);
    }
    clearSearch();
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const showDropdown = isFocused && (searchQuery.length > 0 || recentSearches.length > 0);

  return (
    <div className="relative w-full">
      {/* Search Input */}
      <div
        className={`
          flex items-center gap-3 px-4 py-2.5 h-11 rounded-2xl transition-all duration-200
          bg-white dark:bg-gray-900/70 backdrop-blur-xl
          border shadow-sm
          ${isFocused
            ? 'border-primary-400/60 shadow-primary-500/10 shadow-md ring-1 ring-primary-400/20'
            : 'border-gray-200 dark:border-gray-700/60 hover:border-gray-300 dark:hover:border-gray-600'
          }
        `}
      >
        <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" strokeWidth={2} />
        <input
          ref={inputRef}
          type="text"
          placeholder="Where are you going?"
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => {
              clearSearch();
              inputRef.current?.focus();
            }}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <X className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          </button>
        )}
        {isSearching && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 overflow-hidden z-50 max-h-72 overflow-y-auto rounded-2xl bg-white dark:bg-gray-900/90 backdrop-blur-xl border border-gray-200 dark:border-gray-700/50 shadow-xl"
          >
            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="py-1">
                {searchResults.map((result, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelect(result)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary-50/60 dark:hover:bg-primary-900/20 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {result.name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {result.category && (
                            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
                              {result.category}
                            </span>
                          )}
                          {result.category && (result.address || result.distance != null) && (
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                          )}
                          {result.distance != null ? (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {result.distance < 1000
                                ? `${Math.round(result.distance)}m`
                                : `${(result.distance / 1000).toFixed(1)}km`}
                            </span>
                          ) : result.address ? (
                            <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                              {result.address}
                            </span>
                          ) : userLocation ? (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {getDistanceText(userLocation, result.coordinate)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                ))}
              </div>
            )}

            {/* No results */}
            {searchQuery && !isSearching && searchResults.length === 0 && (
              <div className="px-4 py-8 text-center">
                <MapPin className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No places found</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Try a different search term</p>
              </div>
            )}

            {/* Recent searches */}
            {!searchQuery && recentSearches.length > 0 && (
              <div className="py-1">
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                  Recent
                </p>
                {recentSearches.map((result, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:bg-gray-950/80 dark:hover:bg-gray-800/50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800/80 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 truncate flex-1">
                      {result.name}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getDistanceText(from: { lat: number; lng: number }, to: { lat: number; lng: number }): string {
  const R = 6371000;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (distance < 1000) return `${Math.round(distance)}m away`;
  return `${(distance / 1000).toFixed(1)}km away`;
}
