import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MapPin, Star, Clock, Phone, Globe, Navigation,
  Bookmark, BookmarkCheck, ChevronLeft, ChevronRight,
  ExternalLink, MessageSquare,
} from 'lucide-react';
import {
  getGooglePlaceDetails,
  getGooglePlacePhotos,
  getGooglePlaceReviews,
} from '../../lib/searchapi';
import type { GMapPlaceDetail, GMapPhoto, GMapReview } from '../../lib/searchapi';
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
  const [details, setDetails] = useState<GMapPlaceDetail | null>(null);
  const [photos, setPhotos] = useState<GMapPhoto[]>([]);
  const [reviews, setReviews] = useState<GMapReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!poi) {
      setDetails(null);
      setPhotos([]);
      setReviews([]);
      return;
    }

    const placeId = poi.placeId || poi.dataId || (poi.id.startsWith('gmap-') ? poi.id.replace('gmap-', '') : null);
    if (!placeId) return;

    setLoading(true);
    setPhotoIdx(0);

    Promise.all([
      getGooglePlaceDetails(placeId),
      getGooglePlacePhotos(placeId),
      getGooglePlaceReviews(placeId),
    ]).then(([place, placePhotos, reviewData]) => {
      setDetails(place);
      setPhotos(placePhotos);
      setReviews(reviewData.reviews || []);
      setLoading(false);
    });
  }, [poi?.id]);

  if (!poi) return null;

  const allPhotos = photos.length > 0 ? photos : [];
  const rating = details?.rating ?? poi.rating;
  const reviewCount = details?.reviews ?? poi.reviewCount;
  const phone = details?.phone ?? poi.phone;
  const website = details?.website ?? poi.website;
  const description = details?.description;
  const price = details?.price || poi.price;
  const openState = details?.open_state ?? poi.openState;
  const openHours = details?.open_hours;
  const address = details?.address ?? poi.address;

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
                    src={allPhotos[photoIdx].image || allPhotos[photoIdx].thumbnail}
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
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
                        >
                          {poi.category}
                        </span>
                        {openState && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            openState.toLowerCase().includes('open')
                              ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                              : 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400'
                          }`}>
                            {openState}
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
                          {rating.toFixed(1)}
                        </span>
                        {reviewCount != null && (
                          <span className="text-xs text-gray-400">({reviewCount})</span>
                        )}
                      </div>
                    )}
                    {price && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {price}
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
                  {address && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {address}
                      </p>
                    </div>
                  )}

                  {/* Hours */}
                  {openHours && Object.keys(openHours).length > 0 && (
                    <div className="flex items-start gap-3">
                      <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-0.5">
                        {Object.entries(openHours).map(([day, time]) => (
                          <div key={day} className="flex gap-2">
                            <span className="font-medium w-24 flex-shrink-0">{day}</span>
                            <span>{time}</span>
                          </div>
                        ))}
                      </div>
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

                {/* Google Reviews */}
                {reviews.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5" />
                      Reviews ({reviews.length})
                    </h3>
                    <div className="space-y-2">
                      {reviews.slice(0, 5).map((review, i) => (
                        <div
                          key={review.review_id || i}
                          className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            {review.user?.thumbnail && (
                              <img src={review.user.thumbnail} alt="" className="w-6 h-6 rounded-full" />
                            )}
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              {review.user?.name || 'Anonymous'}
                            </span>
                            {review.user?.is_local_guide && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                                Local Guide
                              </span>
                            )}
                            <div className="flex items-center gap-0.5 ml-auto">
                              <Star className="w-3 h-3 text-amber-400" fill="currentColor" />
                              <span className="text-xs text-gray-500">{review.rating}</span>
                            </div>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-4">
                            {review.snippet || review.text || review.description || ''}
                          </p>
                          {review.date && (
                            <p className="text-[10px] text-gray-400 mt-1">{review.date}</p>
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

                {/* OSM tags for non-Google places */}
                {poi.tags && !poi.id.startsWith('gmap-') && (
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
