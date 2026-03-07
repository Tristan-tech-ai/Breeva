import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MapPin, Star, Clock, Phone, Globe, Navigation,
  Bookmark, BookmarkCheck, ChevronLeft, ChevronRight,
  ExternalLink, Share2, Copy, ChevronDown, ChevronUp,
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
  const [showAllHours, setShowAllHours] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!poi) {
      setDetails(null);
      setPhotos([]);
      setReviews([]);
      setShowAllHours(false);
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

  const allPhotos = photos;
  const rating = details?.rating ?? poi.rating;
  const reviewCount = details?.reviews ?? poi.reviewCount;
  const phone = details?.phone ?? poi.phone;
  const website = details?.website ?? poi.website;
  const description = details?.description;
  const price = details?.price || poi.price;
  const openState = details?.open_state ?? poi.openState;
  const openHours = details?.open_hours;
  const address = details?.address ?? poi.address;
  const histogram = details?.reviews_histogram;

  const distText = poi.distance
    ? poi.distance < 1000
      ? `${Math.round(poi.distance)}m`
      : `${(poi.distance / 1000).toFixed(1)}km`
    : userLocation
      ? formatDist(userLocation, poi.coordinate)
      : null;

  const isOpen = openState ? openState.toLowerCase().includes('open') : null;

  return (
    <AnimatePresence>
      {poi && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={onClose}
          />

          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[90vh] flex flex-col bg-white dark:bg-gray-950 rounded-t-3xl shadow-2xl overflow-hidden"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="w-9 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
              {/* ── Photo Carousel ── */}
              {allPhotos.length > 0 ? (
                <div className="relative w-full h-56 bg-gray-100 dark:bg-gray-900">
                  <img
                    src={allPhotos[photoIdx].image || allPhotos[photoIdx].thumbnail}
                    alt={poi.name}
                    className="w-full h-full object-cover"
                  />
                  {/* Close */}
                  <button
                    onClick={onClose}
                    className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  {/* Photo count badge */}
                  <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-medium">
                    {photoIdx + 1} / {allPhotos.length}
                  </div>
                  {/* Nav arrows */}
                  {allPhotos.length > 1 && (
                    <>
                      <button
                        onClick={() => setPhotoIdx((i) => (i - 1 + allPhotos.length) % allPhotos.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 dark:bg-gray-900/90 flex items-center justify-center shadow-md"
                      >
                        <ChevronLeft className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                      </button>
                      <button
                        onClick={() => setPhotoIdx((i) => (i + 1) % allPhotos.length)}
                        className="absolute right-12 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 dark:bg-gray-900/90 flex items-center justify-center shadow-md"
                      >
                        <ChevronRight className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                      </button>
                    </>
                  )}
                </div>
              ) : loading ? (
                <div className="w-full h-44 bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="w-full h-36 bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-950/30 dark:to-gray-900 flex items-center justify-center relative">
                  <button
                    onClick={onClose}
                    className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/30 flex items-center justify-center text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <MapPin className="w-12 h-12 text-primary-300 dark:text-primary-700" />
                </div>
              )}

              {/* ── Main Content ── */}
              <div className="px-5 pt-4 pb-6">
                {/* Title + Rating */}
                <h2 className="text-[22px] font-bold text-gray-900 dark:text-white leading-tight">
                  {poi.name}
                </h2>

                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {rating != null && (
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{rating.toFixed(1)}</span>
                      <div className="flex">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className="w-3.5 h-3.5"
                            fill={s <= Math.round(rating) ? '#facc15' : 'none'}
                            stroke={s <= Math.round(rating) ? '#facc15' : '#d1d5db'}
                            strokeWidth={1.5}
                          />
                        ))}
                      </div>
                      {reviewCount != null && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">({reviewCount})</span>
                      )}
                    </div>
                  )}
                  {price && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-sm text-gray-500">{price}</span>
                    </>
                  )}
                  {poi.category && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-sm text-gray-500">{poi.category}</span>
                    </>
                  )}
                </div>

                {/* Open state */}
                {openState && (
                  <p className={`text-sm font-medium mt-1 ${
                    isOpen
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-500 dark:text-red-400'
                  }`}>
                    {openState}
                  </p>
                )}

                {/* ── Action Buttons Row (Google Maps style) ── */}
                <div className="flex gap-2 mt-4 overflow-x-auto pb-1 -mx-1 px-1">
                  <button
                    onClick={() => {
                      onNavigate(poi.coordinate, poi.name);
                      onClose();
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary-500 text-white text-sm font-semibold shadow-md shadow-primary-500/20 hover:bg-primary-600 active:scale-95 transition-all flex-shrink-0"
                  >
                    <Navigation className="w-4 h-4" />
                    Directions
                  </button>
                  {onSave && (
                    <button
                      onClick={() => onSave(poi.name, poi.coordinate)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border transition-all flex-shrink-0 ${
                        isSaved
                          ? 'bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400'
                          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      {isSaved ? 'Saved' : 'Save'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const url = `https://www.google.com/maps/place/?q=place_id:${poi.placeId || ''}`;
                      navigator.clipboard?.writeText(url);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all flex-shrink-0"
                  >
                    <Share2 className="w-4 h-4" />
                    Share
                  </button>
                </div>

                {/* ── Description ── */}
                {description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-4">
                    {description}
                  </p>
                )}

                {/* ── Info Section ── */}
                <div className="mt-4 space-y-0 divide-y divide-gray-100 dark:divide-gray-800">
                  {/* Address */}
                  {address && (
                    <button
                      onClick={() => navigator.clipboard?.writeText(address)}
                      className="flex items-center gap-3 py-3 w-full text-left group"
                    >
                      <MapPin className="w-5 h-5 text-primary-500 flex-shrink-0" />
                      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{address}</span>
                      <Copy className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition flex-shrink-0" />
                    </button>
                  )}

                  {/* Hours (collapsible) */}
                  {openHours && Object.keys(openHours).length > 0 && (
                    <div className="py-3">
                      <button
                        onClick={() => setShowAllHours(!showAllHours)}
                        className="flex items-center gap-3 w-full text-left"
                      >
                        <Clock className="w-5 h-5 text-primary-500 flex-shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                          {openState || 'Opening hours'}
                        </span>
                        {showAllHours ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <AnimatePresence>
                        {showAllHours && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="pl-8 pt-2 space-y-1">
                              {Object.entries(openHours).map(([day, time]) => (
                                <div key={day} className="flex text-sm">
                                  <span className="w-28 text-gray-500 dark:text-gray-400 flex-shrink-0">{day}</span>
                                  <span className="text-gray-700 dark:text-gray-300">{time}</span>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Phone */}
                  {phone && (
                    <a href={`tel:${phone}`} className="flex items-center gap-3 py-3">
                      <Phone className="w-5 h-5 text-primary-500 flex-shrink-0" />
                      <span className="text-sm text-primary-600 dark:text-primary-400">{phone}</span>
                    </a>
                  )}

                  {/* Website */}
                  {website && (
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 py-3"
                    >
                      <Globe className="w-5 h-5 text-primary-500 flex-shrink-0" />
                      <span className="text-sm text-primary-600 dark:text-primary-400 truncate flex-1">
                        {website.replace(/^https?:\/\/(www\.)?/, '')}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    </a>
                  )}

                  {distText && (
                    <div className="flex items-center gap-3 py-3">
                      <Navigation className="w-5 h-5 text-primary-500 flex-shrink-0" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{distText} from you</span>
                    </div>
                  )}
                </div>

                {/* ── Rating Histogram ── */}
                {histogram && rating != null && reviewCount != null && reviewCount > 0 && (
                  <div className="mt-5 p-4 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <p className="text-4xl font-bold text-gray-900 dark:text-white">{rating.toFixed(1)}</p>
                        <div className="flex justify-center mt-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className="w-3 h-3" fill={s <= Math.round(rating) ? '#facc15' : 'none'} stroke={s <= Math.round(rating) ? '#facc15' : '#d1d5db'} strokeWidth={1.5} />
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{reviewCount} reviews</p>
                      </div>
                      <div className="flex-1 space-y-1">
                        {[5, 4, 3, 2, 1].map((star) => {
                          const count = histogram[String(star)] || 0;
                          const pct = reviewCount > 0 ? (count / reviewCount) * 100 : 0;
                          return (
                            <div key={star} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-2">{star}</span>
                              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-400 rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Reviews ── */}
                {reviews.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3">
                      Reviews
                    </h3>
                    <div className="space-y-3">
                      {reviews.slice(0, 6).map((review, i) => (
                        <div key={review.review_id || i}>
                          <div className="flex items-center gap-2.5">
                            {review.user?.thumbnail ? (
                              <img src={review.user.thumbnail} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-500">
                                {(review.user?.name || 'A').charAt(0)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {review.user?.name || 'Anonymous'}
                              </p>
                              <div className="flex items-center gap-1.5">
                                <div className="flex">
                                  {[1, 2, 3, 4, 5].map((s) => (
                                    <Star key={s} className="w-2.5 h-2.5" fill={s <= review.rating ? '#facc15' : 'none'} stroke={s <= review.rating ? '#facc15' : '#d1d5db'} strokeWidth={1.5} />
                                  ))}
                                </div>
                                {review.date && (
                                  <span className="text-[10px] text-gray-400">{review.date}</span>
                                )}
                                {review.user?.is_local_guide && (
                                  <span className="text-[10px] font-medium text-blue-500">Local Guide</span>
                                )}
                              </div>
                            </div>
                          </div>
                          {(review.snippet || review.text || review.description) && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-1.5 ml-[42px] line-clamp-3">
                              {review.snippet || review.text || review.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Loading indicator */}
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-gray-400 ml-3">Loading details...</span>
                  </div>
                )}

                {/* Photo thumbnails strip */}
                {allPhotos.length > 1 && (
                  <div className="mt-5">
                    <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3">Photos</h3>
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                      {allPhotos.slice(0, 10).map((photo, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setPhotoIdx(i);
                            scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className={`flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition ${
                            i === photoIdx
                              ? 'border-primary-500'
                              : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <img src={photo.thumbnail || photo.image} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
