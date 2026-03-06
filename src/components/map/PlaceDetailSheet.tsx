import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MapPin, Star, Clock, Phone, Globe, Navigation,
  Bookmark, BookmarkCheck, ChevronLeft, ChevronRight,
  ExternalLink, ShieldCheck,
} from 'lucide-react';
import { fsqPlaceDetails, fsqPlacePhotos, fsqPhotoUrl, getCategoryStyle } from '../../lib/foursquare-api';
import type { FSQPlace, FSQPhoto } from '../../lib/foursquare-api';
import type { POI } from '../../lib/poi-api';
import type { Coordinate } from '../../types';

interface PlaceDetailSheetProps {
  poi: POI | null;
  onClose: () => void;
  onNavigate: (coord: Coordinate, name: string) => void;
  onSave?: (name: string, coord: Coordinate) => void;
  isSaved?: boolean;
  userLocation?: Coordinate | null;
}

export default function PlaceDetailSheet({
  poi,
  onClose,
  onNavigate,
  onSave,
  isSaved = false,
  userLocation,
}: PlaceDetailSheetProps) {
  const [details, setDetails] = useState<FSQPlace | null>(null);
  const [photos, setPhotos] = useState<FSQPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!poi) {
      setDetails(null);
      setPhotos([]);
      return;
    }

    const fsqId = poi.id.startsWith('fsq-') ? poi.id.replace('fsq-', '') : null;
    if (!fsqId) return;

    setLoading(true);
    setPhotoIdx(0);

    Promise.all([fsqPlaceDetails(fsqId), fsqPlacePhotos(fsqId, 10)]).then(
      ([place, placePhotos]) => {
        setDetails(place);
        setPhotos(placePhotos);
        setLoading(false);
      },
    );
  }, [poi?.id]);

  if (!poi) return null;

  const catStyle = getCategoryStyle(poi.category);
  const allPhotos = photos.length > 0 ? photos : details?.photos || [];
  const rating = details?.rating ?? poi.rating;
  const hours = details?.hours;
  const phone = details?.tel ?? poi.phone;
  const website = details?.website ?? poi.website;
  const tips = details?.tips || [];
  const description = details?.description;
  const verified = details?.verified;
  const price = details?.price;

  const distText = poi.distance
    ? poi.distance < 1000
      ? `${Math.round(poi.distance)}m`
      : `${(poi.distance / 1000).toFixed(1)}km`
    : userLocation
      ? formatDist(userLocation, poi.coordinate)
      : null;

  return (
    <AnimatePresence>
      {poi && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] flex flex-col bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl overflow-hidden"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Scrollable content */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
              {/* Photo carousel */}
              {allPhotos.length > 0 ? (
                <div className="relative w-full h-52 bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                  <img
                    src={fsqPhotoUrl(allPhotos[photoIdx], '600x400')}
                    alt={poi.name}
                    className="w-full h-full object-cover"
                    loading="eager"
                  />
                  {allPhotos.length > 1 && (
                    <>
                      <button
                        onClick={() => setPhotoIdx((i) => (i - 1 + allPhotos.length) % allPhotos.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPhotoIdx((i) => (i + 1) % allPhotos.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      {/* Dots */}
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                        {allPhotos.slice(0, 8).map((_, i) => (
                          <div
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full transition ${
                              i === photoIdx ? 'bg-white' : 'bg-white/40'
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="w-full h-32 bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/30 dark:to-primary-950/50 flex items-center justify-center">
                <MapPin className="w-10 h-10 text-primary-400 dark:text-primary-600" />
              </div>
              )}

              {/* Content */}
              <div className="px-5 pt-4 pb-6 space-y-4">
                {/* Header */}
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">
                        {poi.name}
                      </h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: catStyle.color + '18', color: catStyle.color }}
                        >
                          {poi.category}
                        </span>
                        {verified && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-blue-600 dark:text-blue-400">
                            <ShieldCheck className="w-3 h-3" /> Verified
                          </span>
                        )}
                        {distText && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">{distText} away</span>
                        )}
                      </div>
                    </div>

                    {/* Save button */}
                    {onSave && (
                      <button
                        onClick={() => onSave(poi.name, poi.coordinate)}
                        className={`p-2 rounded-xl transition ${
                          isSaved
                            ? 'text-amber-500'
                            : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                        }`}
                      >
                        {isSaved ? (
                          <BookmarkCheck className="w-5 h-5" />
                        ) : (
                          <Bookmark className="w-5 h-5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Rating + Price */}
                  <div className="flex items-center gap-3 mt-2">
                    {rating != null && (
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-amber-400" fill="currentColor" />
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {rating >= 10 ? (rating / 2).toFixed(1) : rating.toFixed(1)}
                        </span>
                        {details?.stats?.total_ratings != null && (
                          <span className="text-xs text-gray-400">({details.stats.total_ratings})</span>
                        )}
                      </div>
                    )}
                    {price != null && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {'$'.repeat(price)}
                      </span>
                    )}
                    {hours && (
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          hours.open_now
                            ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                            : 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400'
                        }`}
                      >
                        {hours.open_now ? 'Open Now' : 'Closed'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Description */}
                {description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {description}
                  </p>
                )}

                {/* Info rows */}
                <div className="space-y-2.5">
                  {/* Address */}
                  {(details?.location?.formatted_address || poi.address) && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {details?.location?.formatted_address || poi.address}
                      </p>
                    </div>
                  )}

                  {/* Hours */}
                  {hours?.display && (
                    <div className="flex items-start gap-3">
                      <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
                        {hours.display}
                      </p>
                    </div>
                  )}

                  {/* Phone */}
                  {phone && (
                    <div className="flex items-start gap-3">
                      <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <a href={`tel:${phone}`} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
                        {phone}
                      </a>
                    </div>
                  )}

                  {/* Website */}
                  {website && (
                    <div className="flex items-start gap-3">
                      <Globe className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <a
                        href={website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 truncate max-w-[250px]"
                      >
                        {website.replace(/^https?:\/\/(www\.)?/, '')}
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    </div>
                  )}
                </div>

                {/* Tips / Reviews */}
                {tips.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                      Tips & Reviews
                    </h3>
                    <div className="space-y-2">
                      {tips.slice(0, 5).map((tip) => (
                        <div
                          key={tip.id}
                          className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800"
                        >
                          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            "{tip.text}"
                          </p>
                          {tip.agree_count != null && tip.agree_count > 0 && (
                            <p className="text-[10px] text-gray-400 mt-1">
                              👍 {tip.agree_count} agree
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Loading state for details */}
                {loading && (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-gray-400 ml-2">Loading details...</span>
                  </div>
                )}

                {/* OSM tags for non-Foursquare places */}
                {poi.tags && !poi.id.startsWith('fsq-') && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(poi.tags)
                      .filter(([k]) => ['cuisine', 'opening_hours', 'internet_access', 'wheelchair'].includes(k))
                      .map(([k, v]) => (
                        <span
                          key={k}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                        >
                          {k}: {v}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom action bar */}
            <div className="flex-shrink-0 px-5 pb-5 pt-2 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
              <button
                onClick={() => {
                  onNavigate(poi.coordinate, poi.name);
                  onClose();
                }}
                className="w-full gradient-primary text-white py-3.5 rounded-2xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all flex items-center justify-center gap-2"
              >
                <Navigation className="w-4 h-4" />
                Navigate Here
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function formatDist(a: Coordinate, b: Coordinate): string {
  const R = 6371e3;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const d = R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`;
}
