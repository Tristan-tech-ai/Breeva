import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, MapPin, Clock, Loader2, Star, SlidersHorizontal } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import type { POI } from '../../lib/poi-api';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fieldBase } from '../../lib/field/source';
import { kabKotaUntukCari, muatIndeksKabKota, type KabKota } from '../../lib/nasional/kabkota';

export interface FilterChip {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

interface SearchBarProps {
  onPlaceSelect?: (poi: POI) => void;
  filterChips?: FilterChip[];
  activeFilter?: string | null;
  onFilterChange?: (filter: string | null) => void;
}

export default function SearchBar({ onPlaceSelect, filterChips, activeFilter, onFilterChange }: SearchBarProps) {
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
    siapkanCari,
  } = useMapStore();

  const [isFocused, setIsFocused] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // N-49: the 513 kab/kota, loaded when the box is first used; answers shown above the places
  const [indeksKab, setIndeksKab] = useState<KabKota[]>([]);
  const kabCocok = kabKotaUntukCari(indeksKab, searchQuery);

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

  // Close filter panel on outside click/tap
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [filterOpen]);

  const handleSelect = (result: (typeof searchResults)[number]) => {
    useMapStore.getState().setViewTarget(result.coordinate);

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

  const showDropdown = isFocused && !filterOpen && (searchQuery.length > 0 || recentSearches.length > 0);
  const pilihKab = (k: KabKota) => {
    // zoom 13: outside the pilot regions the phone colours the roads by vehicle exhaust there (indicative, N-21)
    useMapStore.getState().setViewTarget({ lat: k.lat, lng: k.lon, zoom: 13 });
    clearSearch();
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const hasFilter = filterChips && filterChips.length > 0;
  const activeChip = hasFilter ? filterChips.find(c => c.key === activeFilter) : undefined;

  return (
    <div className="relative w-full" ref={filterRef} role="combobox" aria-expanded={showDropdown} aria-owns={showDropdown ? 'search-results-list' : undefined} aria-haspopup="listbox">
      {/* Search Input */}
      <div
        className={`
          flex items-center gap-3 px-4 py-2.5 h-12 rounded-full transition-all duration-200 overflow-hidden
          bg-white dark:bg-gray-900/80 backdrop-blur-xl
          ${isFocused
            ? 'shadow-lg ring-2 ring-primary-400/30 dark:ring-primary-600/30'
            : 'shadow-md hover:shadow-lg'
          }
        `}
      >
        <Search className="w-[18px] h-[18px] text-primary-500 dark:text-primary-400 flex-shrink-0" strokeWidth={2.2} />
        <label htmlFor="search-input" className="sr-only">Cari tempat</label>
        <input
          id="search-input"
          ref={inputRef}
          type="text"
          role="searchbox"
          aria-autocomplete="list"
          aria-controls={showDropdown ? 'search-results-list' : undefined}
          placeholder="Cari di sini"
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { setIsFocused(true); setFilterOpen(false); siapkanCari(); void muatIndeksKabKota(fieldBase()).then(setIndeksKab).catch(() => {}); }}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          className="flex-1 self-stretch bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none"
        />
        <div className="w-6 flex items-center justify-center flex-shrink-0">
          {isSearching && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
          {searchQuery && !isSearching && (
            <button aria-label="Hapus pencarian"
              onClick={() => {
                clearSearch();
                inputRef.current?.focus();
              }}
              className="p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        {/* Filter icon */}
        {hasFilter && (
          <button
            onClick={() => { setFilterOpen(v => !v); setIsFocused(false); inputRef.current?.blur(); }}
            aria-label={activeChip ? `Saring tempat: ${activeChip.label}` : 'Saring tempat'}
            aria-expanded={filterOpen}
            className="relative p-1.5 -mr-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition flex-shrink-0"
          >
            <SlidersHorizontal aria-hidden className="w-4 h-4 text-gray-500 dark:text-gray-400" strokeWidth={2} />
            {activeChip && (
              <span
                className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-gray-900"
                style={{ backgroundColor: activeChip.color }}
              />
            )}
          </button>
        )}
      </div>

      {/* Filter dropdown panel */}
      {/* CSS drop-in instead of framer-motion (X-W62) */}
      {filterOpen && hasFilter && (
          <div
            className="anim-turun absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800 p-3"
          >
            <div className="grid grid-cols-4 gap-2">
              {filterChips!.map(chip => {
                const Icon = chip.icon;
                const isActive = activeFilter === chip.key;
                return (
                  <button
                    key={chip.key}
                    onClick={() => {
                      onFilterChange?.(isActive ? null : chip.key);
                      setFilterOpen(false);
                    }}
                    className={`flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl transition-all duration-150 ${
                      isActive
                        ? 'text-white shadow-md'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    }`}
                    style={isActive ? {
                      backgroundColor: chip.color,
                      boxShadow: `0 2px 10px ${chip.color}40`,
                    } : undefined}
                  >
                    <Icon className="w-5 h-5" strokeWidth={1.8} />
                    <span className="text-[10px] font-medium leading-tight">{chip.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
          <div
            className="anim-turun absolute top-full left-0 right-0 mt-2 z-50 max-h-[60vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800"
            id="search-results-list"
            role="listbox"
          >
            {kabCocok.length > 0 && (
              <div className="border-b border-gray-100 dark:border-gray-800" data-cari-kabkota>
                <p className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Kabupaten/kota</p>
                {kabCocok.map((k) => (
                  <div key={k.slug} className="flex items-center gap-2 px-4 py-2">
                    <button role="option" aria-selected={false} onClick={() => pilihKab(k)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="w-10 h-10 rounded-full bg-sky-50 dark:bg-sky-900/40 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-4 h-4 text-sky-700 dark:text-sky-300" />
                      </div>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-white">{k.nama}</span>
                        <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{k.provinsi} · asap kendaraan di peta: indikatif</span>
                      </span>
                    </button>
                    <Link to={`/pantau/${k.slug}`} className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200">Pantau</Link>
                  </div>
                ))}
              </div>
            )}
            {/* Search results */}
            {searchResults.length > 0 && (
              <div>
                {searchResults.map((result, i) => (
                  <button
                    key={result.placeId || result.dataId || i}
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
                  >
                    {/* Thumbnail or icon */}
                    {result.thumbnail ? (
                      <img
                        src={result.thumbnail}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-gray-100 dark:border-gray-700"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-4 h-4 text-gray-400" />
                      </div>
                    )}

                    {/* Text content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">
                          {result.name}
                        </p>
                        {result.rating != null && (
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <Star className="w-3 h-3 text-amber-400" fill="currentColor" />
                            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                              {result.rating.toFixed(1)}
                              {result.reviewCount != null && <span className="text-gray-400 dark:text-gray-500"> ({result.reviewCount})</span>}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {result.category && (
                          <span className="truncate">{result.category}</span>
                        )}
                        {result.category && result.price && (
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                        )}
                        {result.price && <span>{result.price}</span>}
                        {(result.category || result.price) && result.openState && (
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                        )}
                        {result.openState && (
                          <span className={`font-medium flex-shrink-0 ${
                            result.openState.toLowerCase().includes('open')
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-500 dark:text-red-400'
                          }`}>
                            {result.hours || result.openState}
                          </span>
                        )}
                      </div>

                      {result.address && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                          {result.address}
                        </p>
                      )}

                      {result.description && !result.address && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                          {result.description}
                        </p>
                      )}
                    </div>

                    {/* Distance */}
                    {(result.distance != null || userLocation) && (
                      <span className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 flex-shrink-0 whitespace-nowrap">
                        {result.distance != null
                          ? result.distance < 1000
                            ? `${Math.round(result.distance)}m`
                            : `${(result.distance / 1000).toFixed(1)}km`
                          : userLocation
                            ? getDistanceText(userLocation, result.coordinate)
                            : ''}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* No results */}
            {searchQuery && !isSearching && searchResults.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Search className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Tempat tidak ditemukan</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Coba kata pencarian lain</p>
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
          </div>
      )}
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
  if (distance < 1000) return `${Math.round(distance)} m dari sini`;
  return `${(distance / 1000).toFixed(1).replace('.', ',')} km dari sini`;
}
