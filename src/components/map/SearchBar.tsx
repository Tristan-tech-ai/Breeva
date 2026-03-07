import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, MapPin, Clock, Loader2, Star, Navigation } from 'lucide-react';
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
      }, 350);
    },
    [setSearchQuery, search],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSelect = (result: (typeof searchResults)[number]) => {
    if ((result.placeId || result.dataId) && onPlaceSelect) {
      const poi: POI = {
        id: `gmap-${result.placeId || result.dataId}`,
        name: result.name,
        category: result.category || 'Place',
        coordinate: result.coordinate,
        distance: result.distance,
        address: result.address,
        placeId: result.placeId,
        dataId: result.dataId,
        rating: result.rating,
        reviewCount: result.reviewCount,
        thumbnail: result.thumbnail,
        openState: result.openState,
        types: result.types,
        price: result.price,
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
          flex items-center gap-3 px-4 py-2.5 h-12 rounded-full transition-all duration-200
          bg-white dark:bg-gray-900/80 backdrop-blur-xl
          ${isFocused
            ? 'shadow-lg ring-2 ring-primary-400/30 dark:ring-primary-600/30'
            : 'shadow-md hover:shadow-lg'
          }
        `}
      >
        <Search className="w-[18px] h-[18px] text-primary-500 dark:text-primary-400 flex-shrink-0" strokeWidth={2.2} />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search here"
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none"
        />
        {isSearching && <Loader2 className="w-4 h-4 text-primary-500 animate-spin flex-shrink-0" />}
        {searchQuery && !isSearching && (
          <button
            onClick={() => {
              clearSearch();
              inputRef.current?.focus();
            }}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 z-50 max-h-[60vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800"
          >
            {/* Search results — Google Maps style */}
            {searchResults.length > 0 && (
              <div className="py-1.5">
                {searchResults.map((result, i) => (
                  <button
                    key={result.placeId || result.dataId || i}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
                  >
                    {/* Thumbnail or icon */}
                    {result.thumbnail ? (
                      <img
                        src={result.thumbnail}
                        alt=""
                        className="w-11 h-11 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-5 h-5 text-gray-400" />
                      </div>
                    )}

                    {/* Text content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {result.name}
                      </p>

                      {/* Rating + category + open state row */}
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {result.rating != null && (
                          <div className="flex items-center gap-0.5">
                            <Star className="w-3 h-3 text-amber-400" fill="currentColor" />
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                              {result.rating.toFixed(1)}
                            </span>
                            {result.reviewCount != null && (
                              <span className="text-[10px] text-gray-400">({result.reviewCount})</span>
                            )}
                          </div>
                        )}
                        {result.rating != null && result.category && (
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                        )}
                        {result.category && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">{result.category}</span>
                        )}
                        {result.price && (
                          <>
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                            <span className="text-xs text-gray-500">{result.price}</span>
                          </>
                        )}
                      </div>

                      {/* Address + distance */}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {result.openState && (
                          <span className={`text-[10px] font-medium ${
                            result.openState.toLowerCase().includes('open')
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-500 dark:text-red-400'
                          }`}>
                            {result.openState}
                          </span>
                        )}
                        {result.openState && result.address && (
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                        )}
                        {result.address && (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                            {result.address}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Distance badge */}
                    {(result.distance != null || userLocation) && (
                      <div className="flex flex-col items-end flex-shrink-0 pt-0.5">
                        <span className="text-[11px] font-medium text-primary-600 dark:text-primary-400">
                          {result.distance != null
                            ? result.distance < 1000
                              ? `${Math.round(result.distance)}m`
                              : `${(result.distance / 1000).toFixed(1)}km`
                            : userLocation
                              ? getDistanceText(userLocation, result.coordinate)
                              : ''}
                        </span>
                        <Navigation className="w-3 h-3 text-gray-300 dark:text-gray-600 mt-0.5" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* No results */}
            {searchQuery && !isSearching && searchResults.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Search className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No places found</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try a different search term</p>
              </div>
            )}

            {/* Recent searches */}
            {!searchQuery && recentSearches.length > 0 && (
              <div className="py-1.5">
                <p className="px-4 pt-2 pb-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                  Recent
                </p>
                {recentSearches.map((result, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{result.name}</p>
                      {result.address && (
                        <p className="text-[11px] text-gray-400 truncate">{result.address}</p>
                      )}
                    </div>
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
