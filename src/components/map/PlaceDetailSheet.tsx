import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MapPin, Star, Clock, Phone, Globe, Navigation,
  Bookmark, BookmarkCheck, ChevronLeft, ChevronRight,
  ExternalLink, Share2, Copy, ChevronDown, ChevronUp,
  Check, Image,
} from 'lucide-react';
import {
  getGooglePlaceDetails,
  getGooglePlacePhotos,
  getGooglePlaceReviews,
} from '../../lib/searchapi';
import type { GMapPlaceDetail, GMapPhoto, GMapReview } from '../../lib/searchapi';
import type { POI } from '../../lib/poi-api';
import type { Coordinate } from '../../types';

type Tab = 'overview' | 'reviews' | 'photos' | 'about';

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
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!poi) {
      setDetails(null);
      setPhotos([]);
      setReviews([]);
      setShowAllHours(false);
      setActiveTab('overview');
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
  const extensions = details?.extensions;

  const distText = poi.distance
    ? poi.distance < 1000
      ? `${Math.round(poi.distance)}m`
      : `${(poi.distance / 1000).toFixed(1)}km`
    : userLocation
      ? formatDist(userLocation, poi.coordinate)
      : null;

  const isOpen = openState ? openState.toLowerCase().includes('open') : null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'reviews', label: 'Reviews' },
    { key: 'photos', label: 'Photos' },
    { key: 'about', label: 'About' },
  ];

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
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[92vh] flex flex-col bg-white dark:bg-gray-950 rounded-t-3xl shadow-2xl overflow-hidden"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="w-9 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />
            </div>

            {/* ── Header: Name + Close ── */}
            <div className="px-5 pb-2 flex items-start justify-between flex-shrink-0">
              <div className="flex-1 min-w-0 pr-3">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">
                  {poi.name}
                </h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
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
                      <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                      <span className="text-sm text-gray-500">{price}</span>
                    </>
                  )}
                  {poi.category && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                      <span className="text-sm text-gray-500">{poi.category}</span>
                    </>
                  )}
                </div>
                {openState && (
                  <p className={`text-sm font-medium mt-0.5 ${
                    isOpen ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
                  }`}>
                    {openState}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* ── Tab Bar ── */}
            <div className="flex border-b border-gray-200 dark:border-gray-800 px-5 flex-shrink-0">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    scrollRef.current?.scrollTo({ top: 0 });
                  }}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Scrollable Tab Content ── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">

              {/* ═══ OVERVIEW TAB ═══ */}
              {activeTab === 'overview' && (
                <div className="px-5 pt-4 pb-6">
                  {/* Action Buttons */}
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    <button
                      onClick={() => { onNavigate(poi.coordinate, poi.name); onClose(); }}
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
                            : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                        {isSaved ? 'Saved' : 'Save'}
                      </button>
                    )}
                    {phone && (
                      <a
                        href={`tel:${phone}`}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 transition-all flex-shrink-0"
                      >
                        <Phone className="w-4 h-4" />
                        Call
                      </a>
                    )}
                    <button
                      onClick={() => {
                        const url = `https://www.google.com/maps/place/?q=place_id:${poi.placeId || ''}`;
                        navigator.clipboard?.writeText(url);
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 transition-all flex-shrink-0"
                    >
                      <Share2 className="w-4 h-4" />
                      Share
                    </button>
                  </div>

                  {/* Description */}
                  {description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-4">
                      {description}
                    </p>
                  )}

                  {/* Info rows */}
                  <div className="mt-4 space-y-0 divide-y divide-gray-100 dark:divide-gray-800/50">
                    {address && (
                      <button
                        onClick={() => navigator.clipboard?.writeText(address)}
                        className="flex items-center gap-3 py-3 w-full text-left group"
                      >
                        <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{address}</span>
                        <Copy className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition flex-shrink-0" />
                      </button>
                    )}

                    {openHours && Object.keys(openHours).length > 0 && (
                      <div className="py-3">
                        <button
                          onClick={() => setShowAllHours(!showAllHours)}
                          className="flex items-center gap-3 w-full text-left"
                        >
                          <Clock className="w-5 h-5 text-gray-400 flex-shrink-0" />
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

                    {phone && (
                      <a href={`tel:${phone}`} className="flex items-center gap-3 py-3">
                        <Phone className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-primary-600 dark:text-primary-400">{phone}</span>
                      </a>
                    )}

                    {website && (
                      <a href={website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-3">
                        <Globe className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-primary-600 dark:text-primary-400 truncate flex-1">
                          {website.replace(/^https?:\/\/(www\.)?/, '')}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      </a>
                    )}

                    {distText && (
                      <div className="flex items-center gap-3 py-3">
                        <Navigation className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{distText} from you</span>
                      </div>
                    )}
                  </div>

                  {/* Photo strip preview */}
                  {allPhotos.length > 0 && (
                    <div className="mt-4">
                      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                        {allPhotos.slice(0, 6).map((photo, i) => (
                          <button
                            key={i}
                            onClick={() => { setPhotoIdx(i); setActiveTab('photos'); }}
                            className="flex-shrink-0 w-28 h-20 rounded-xl overflow-hidden"
                          >
                            <img src={photo.thumbnail || photo.image} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                        {allPhotos.length > 6 && (
                          <button
                            onClick={() => setActiveTab('photos')}
                            className="flex-shrink-0 w-28 h-20 rounded-xl bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center"
                          >
                            <Image className="w-5 h-5 text-gray-400" />
                            <span className="text-xs text-gray-500 mt-0.5">+{allPhotos.length - 6}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Rating histogram mini */}
                  {histogram && rating != null && reviewCount != null && reviewCount > 0 && (
                    <button
                      onClick={() => setActiveTab('reviews')}
                      className="mt-4 w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <p className="text-3xl font-bold text-gray-900 dark:text-white">{rating.toFixed(1)}</p>
                          <div className="flex justify-center mt-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} className="w-3 h-3" fill={s <= Math.round(rating) ? '#facc15' : 'none'} stroke={s <= Math.round(rating) ? '#facc15' : '#d1d5db'} strokeWidth={1.5} />
                            ))}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{reviewCount} reviews</p>
                        </div>
                        <div className="flex-1 space-y-0.5">
                          {[5, 4, 3, 2, 1].map((star) => {
                            const count = histogram[String(star)] || 0;
                            const pct = reviewCount > 0 ? (count / reviewCount) * 100 : 0;
                            return (
                              <div key={star} className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 w-2">{star}</span>
                                <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </button>
                  )}

                  {loading && (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-gray-400 ml-3">Loading details...</span>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ REVIEWS TAB ═══ */}
              {activeTab === 'reviews' && (
                <div className="px-5 pt-4 pb-6">
                  {/* Summary */}
                  {histogram && rating != null && reviewCount != null && reviewCount > 0 && (
                    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 mb-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <p className="text-4xl font-bold text-gray-900 dark:text-white">{rating.toFixed(1)}</p>
                          <div className="flex justify-center mt-1">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} className="w-3.5 h-3.5" fill={s <= Math.round(rating) ? '#facc15' : 'none'} stroke={s <= Math.round(rating) ? '#facc15' : '#d1d5db'} strokeWidth={1.5} />
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
                                  <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reviews list */}
                  {reviews.length > 0 ? (
                    <div className="space-y-4">
                      {reviews.map((review, i) => (
                        <div key={review.review_id || i} className="pb-4 border-b border-gray-100 dark:border-gray-800/50 last:border-b-0">
                          <div className="flex items-center gap-2.5">
                            {review.user?.thumbnail ? (
                              <img src={review.user.thumbnail} alt="" className="w-9 h-9 rounded-full" />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-500">
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
                                    <Star key={s} className="w-3 h-3" fill={s <= review.rating ? '#facc15' : 'none'} stroke={s <= review.rating ? '#facc15' : '#d1d5db'} strokeWidth={1.5} />
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
                            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-2 line-clamp-4">
                              {review.snippet || review.text || review.description}
                            </p>
                          )}
                          {/* Review photos */}
                          {review.images && review.images.length > 0 && (
                            <div className="flex gap-2 mt-2 overflow-x-auto">
                              {review.images.slice(0, 4).map((img, j) => (
                                <img
                                  key={j}
                                  src={typeof img === 'string' ? img : img.image}
                                  alt=""
                                  className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : loading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-gray-400 ml-3">Loading reviews...</span>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Star className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No reviews yet</p>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ PHOTOS TAB ═══ */}
              {activeTab === 'photos' && (
                <div className="px-5 pt-4 pb-6">
                  {allPhotos.length > 0 ? (
                    <>
                      {/* Hero photo with navigation */}
                      <div className="relative w-full h-56 rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-900 mb-3">
                        <img
                          src={allPhotos[photoIdx].image || allPhotos[photoIdx].thumbnail}
                          alt={poi.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-medium">
                          {photoIdx + 1} / {allPhotos.length}
                        </div>
                        {allPhotos.length > 1 && (
                          <>
                            <button
                              onClick={() => setPhotoIdx((i) => (i - 1 + allPhotos.length) % allPhotos.length)}
                              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 dark:bg-gray-900/90 flex items-center justify-center shadow-md"
                            >
                              <ChevronLeft className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                            </button>
                            <button
                              onClick={() => setPhotoIdx((i) => (i + 1) % allPhotos.length)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 dark:bg-gray-900/90 flex items-center justify-center shadow-md"
                            >
                              <ChevronRight className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Photo grid */}
                      <div className="grid grid-cols-3 gap-1.5">
                        {allPhotos.map((photo, i) => (
                          <button
                            key={i}
                            onClick={() => setPhotoIdx(i)}
                            className={`aspect-square rounded-lg overflow-hidden border-2 transition ${
                              i === photoIdx ? 'border-primary-500' : 'border-transparent'
                            }`}
                          >
                            <img src={photo.thumbnail || photo.image} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </>
                  ) : loading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-gray-400 ml-3">Loading photos...</span>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Image className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No photos available</p>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ ABOUT TAB ═══ */}
              {activeTab === 'about' && (
                <div className="px-5 pt-4 pb-6">
                  {/* Basic info */}
                  <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-800/50">
                    {address && (
                      <div className="flex items-start gap-3 py-3">
                        <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{address}</span>
                      </div>
                    )}
                    {phone && (
                      <div className="flex items-center gap-3 py-3">
                        <Phone className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{phone}</span>
                      </div>
                    )}
                    {website && (
                      <div className="flex items-center gap-3 py-3">
                        <Globe className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <a href={website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 dark:text-primary-400 truncate">
                          {website.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Extensions / Features (like Google Maps About tab) */}
                  {extensions && extensions.length > 0 && (
                    <div className="mt-4 space-y-5">
                      {extensions.map((section, idx) => (
                        <div key={idx}>
                          <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-2.5">{section.title}</h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            {section.items.map((item, j) => (
                              <div key={j} className="flex items-center gap-2">
                                <Check className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <span className="text-sm text-gray-600 dark:text-gray-400">{item.title || item.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Opening hours full */}
                  {openHours && Object.keys(openHours).length > 0 && (
                    <div className="mt-5">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-2.5">Hours</h4>
                      <div className="space-y-1.5">
                        {Object.entries(openHours).map(([day, time]) => (
                          <div key={day} className="flex text-sm">
                            <span className="w-28 text-gray-500 dark:text-gray-400 flex-shrink-0">{day}</span>
                            <span className="text-gray-700 dark:text-gray-300">{time}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Types/Categories */}
                  {poi.types && poi.types.length > 0 && (
                    <div className="mt-5">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Categories</h4>
                      <div className="flex flex-wrap gap-2">
                        {poi.types.map(type => (
                          <span key={type} className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                            {type.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {!extensions && !openHours && !(poi.types && poi.types.length > 0) && !loading && (
                    <div className="text-center py-12">
                      <MapPin className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No additional info available</p>
                    </div>
                  )}

                  {loading && (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              )}
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
