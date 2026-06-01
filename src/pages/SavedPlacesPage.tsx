import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, MapPin, Home, Briefcase, Heart, Trash2, Navigation2, Plus, Search, Share2,
  Coffee, UtensilsCrossed, TreePine, Dumbbell, GraduationCap, Cross, Wind,
  Church, ShoppingBag, Landmark, Hotel, Bus, Clock, Sparkles, LocateFixed, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSavedPlacesStore } from '../stores/savedPlacesStore';
import { useAuthStore } from '../stores/authStore';
import { useMapStore } from '../stores/mapStore';
import { getAirQuality } from '../lib/api';
import BottomNavigation from '../components/layout/BottomNavigation';
import type { SavedPlace, Coordinate, AirQualityData, AQILevel } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
type CatKey = SavedPlace['category'];
const CATEGORY_CONFIG: Record<string, { icon: LucideIcon; tint: string; grad: string; label: string }> = {
  home:      { icon: Home,            tint: 'bg-blue-50 dark:bg-blue-500/10 text-blue-500',          grad: 'from-blue-500 to-blue-600',       label: 'Rumah' },
  work:      { icon: Briefcase,       tint: 'bg-amber-50 dark:bg-amber-500/10 text-amber-500',        grad: 'from-amber-500 to-amber-600',     label: 'Kantor' },
  favorite:  { icon: Heart,           tint: 'bg-rose-50 dark:bg-rose-500/10 text-rose-500',           grad: 'from-rose-500 to-rose-600',       label: 'Favorit' },
  food:      { icon: UtensilsCrossed, tint: 'bg-orange-50 dark:bg-orange-500/10 text-orange-500',     grad: 'from-orange-500 to-orange-600',   label: 'Makan' },
  cafe:      { icon: Coffee,          tint: 'bg-yellow-50 dark:bg-yellow-500/10 text-yellow-600',     grad: 'from-yellow-500 to-yellow-600',   label: 'Kafe' },
  park:      { icon: TreePine,        tint: 'bg-green-50 dark:bg-green-500/10 text-green-500',         grad: 'from-green-500 to-green-600',     label: 'Taman' },
  gym:       { icon: Dumbbell,        tint: 'bg-violet-50 dark:bg-violet-500/10 text-violet-500',      grad: 'from-violet-500 to-violet-600',   label: 'Gym' },
  school:    { icon: GraduationCap,   tint: 'bg-sky-50 dark:bg-sky-500/10 text-sky-500',               grad: 'from-sky-500 to-sky-600',         label: 'Sekolah' },
  hospital:  { icon: Cross,           tint: 'bg-red-50 dark:bg-red-500/10 text-red-500',               grad: 'from-red-500 to-red-600',         label: 'RS' },
  mosque:    { icon: Landmark,        tint: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600',   grad: 'from-emerald-500 to-emerald-600', label: 'Masjid' },
  church:    { icon: Church,          tint: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500',      grad: 'from-indigo-500 to-indigo-600',   label: 'Gereja' },
  shop:      { icon: ShoppingBag,     tint: 'bg-pink-50 dark:bg-pink-500/10 text-pink-500',            grad: 'from-pink-500 to-pink-600',       label: 'Toko' },
  landmark:  { icon: Landmark,        tint: 'bg-teal-50 dark:bg-teal-500/10 text-teal-500',            grad: 'from-teal-500 to-teal-600',       label: 'Landmark' },
  hotel:     { icon: Hotel,           tint: 'bg-purple-50 dark:bg-purple-500/10 text-purple-500',      grad: 'from-purple-500 to-purple-600',   label: 'Hotel' },
  transport: { icon: Bus,             tint: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-500',            grad: 'from-cyan-500 to-cyan-600',       label: 'Transport' },
  custom:    { icon: MapPin,          tint: 'bg-primary-50 dark:bg-primary-500/10 text-primary-500',   grad: 'from-primary-500 to-primary-600', label: 'Lainnya' },
};
const catCfg = (c: string) => CATEGORY_CONFIG[c] ?? CATEGORY_CONFIG.custom;

const AQI_META: Record<AQILevel, { label: string; color: string }> = {
  'good':                { label: 'Bersih',      color: '#22c55e' },
  'moderate':            { label: 'Sedang',      color: '#eab308' },
  'unhealthy-sensitive': { label: 'Kurang',      color: '#f97316' },
  'unhealthy':           { label: 'Tidak Sehat', color: '#ef4444' },
  'very-unhealthy':      { label: 'Buruk',       color: '#a855f7' },
  'hazardous':           { label: 'Bahaya',      color: '#7f1d1d' },
};

type SortKey = 'recent' | 'nearest' | 'cleanest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function distanceKm(a: Coordinate, b: Coordinate): number {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function fmtDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} hari lalu`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo} bln lalu` : `${Math.floor(mo / 12)} thn lalu`;
}

/** Fetch live AQI for each place (batched, cached via getAirQuality). */
function usePlaceAqi(places: SavedPlace[]): Record<string, AirQualityData | null> {
  const [aqiMap, setAqiMap] = useState<Record<string, AirQualityData | null>>({});
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    const todo = places.filter((p) => !known.current.has(p.id)).slice(0, 30);
    if (!todo.length) return;
    todo.forEach((p) => known.current.add(p.id));
    let cancelled = false;
    (async () => {
      for (let i = 0; i < todo.length; i += 6) {
        const batch = todo.slice(i, i + 6);
        const res = await Promise.allSettled(
          batch.map((p) => getAirQuality(p.coordinate).then((r) => ({ id: p.id, data: r.data })))
        );
        if (cancelled) return;
        setAqiMap((prev) => {
          const next = { ...prev };
          res.forEach((r) => { if (r.status === 'fulfilled') next[r.value.id] = r.value.data; });
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [places]);
  return aqiMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────────────
function AqiBadge({ data, pending }: { data: AirQualityData | null | undefined; pending: boolean }) {
  if (data === undefined) {
    return pending ? <span className="inline-block w-16 h-[18px] rounded-full skeleton-shimmer" /> : null;
  }
  if (data === null) return null;
  const m = AQI_META[data.level];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold"
      style={{ color: m.color, backgroundColor: `${m.color}1f` }}
    >
      <Wind className="w-2.5 h-2.5" />
      AQI {data.aqi} · {m.label}
    </span>
  );
}

function CatEmblem({ category, size = 'md' }: { category: string; size?: 'md' | 'sm' }) {
  const cfg = catCfg(category);
  const Icon = cfg.icon;
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  return (
    <div className={`${dim} rounded-2xl bg-gradient-to-br ${cfg.grad} flex items-center justify-center shrink-0 shadow-sm`}>
      <Icon className={size === 'sm' ? 'w-4 h-4 text-white' : 'w-5 h-5 text-white'} strokeWidth={2.1} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function SavedPlacesPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { places, removePlace, addPlace, fetchCloudPlaces } = useSavedPlacesStore();
  const userLocation = useMapStore((s) => s.userLocation);

  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState<CatKey>('favorite');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) fetchCloudPlaces(user.id); }, [user, fetchCloudPlaces]);

  const aqiMap = usePlaceAqi(places);

  // categories actually present (+ all)
  const presentCats = useMemo(() => {
    const set = new Set(places.map((p) => p.category));
    return ['all', ...Object.keys(CATEGORY_CONFIG).filter((c) => set.has(c as CatKey))];
  }, [places]);

  const visible = useMemo(() => {
    let list = places.filter((p) => {
      if (filter !== 'all' && p.category !== filter) return false;
      if (query && !(p.name.toLowerCase().includes(query.toLowerCase()) || (p.address ?? '').toLowerCase().includes(query.toLowerCase()))) return false;
      return true;
    });
    if (sort === 'nearest' && userLocation) {
      list = [...list].sort((a, b) => distanceKm(userLocation, a.coordinate) - distanceKm(userLocation, b.coordinate));
    } else if (sort === 'cleanest') {
      list = [...list].sort((a, b) => {
        const av = aqiMap[a.id]?.aqi ?? Infinity, bv = aqiMap[b.id]?.aqi ?? Infinity;
        return av - bv;
      });
    }
    return list;
  }, [places, filter, query, sort, userLocation, aqiMap]);

  // Cleanest-air saved place (for the hero highlight)
  const cleanest = useMemo(() => {
    let best: { place: SavedPlace; aqi: number } | null = null;
    for (const p of places) {
      const a = aqiMap[p.id];
      if (a && (!best || a.aqi < best.aqi)) best = { place: p, aqi: a.aqi };
    }
    return best;
  }, [places, aqiMap]);

  const home = places.find((p) => p.category === 'home');
  const work = places.find((p) => p.category === 'work');

  const goNavigate = useCallback((place: SavedPlace) => {
    navigate('/home', { state: { destination: place.coordinate, destinationName: place.name } });
  }, [navigate]);

  const share = useCallback(async (place: SavedPlace) => {
    const text = `📍 ${place.name}\n📌 ${place.address || `${place.coordinate.lat.toFixed(4)}, ${place.coordinate.lng.toFixed(4)}`}\n\nDibagikan via Breeva — eco-walk app\nhttps://breeva.site`;
    try {
      if (navigator.share) await navigator.share({ title: place.name, text });
      else { await navigator.clipboard.writeText(text); alert('Info tempat disalin ke clipboard!'); }
    } catch { /* cancelled */ }
  }, []);

  const openAdd = (cat: CatKey = 'favorite') => { setNewCat(cat); setShowAdd(true); };

  const saveCurrent = () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        addPlace(newName.trim(), { lat: pos.coords.latitude, lng: pos.coords.longitude }, newCat);
        setNewName(''); setShowAdd(false); setSaving(false);
      },
      () => { alert('Tidak bisa mengambil lokasi saat ini'); setSaving(false); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const pending = places.length > 0 && Object.keys(aqiMap).length < Math.min(places.length, 30);

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-16 w-72 h-72 rounded-full bg-primary-400/15 blur-3xl" />
      <div className="pointer-events-none absolute -top-10 -right-20 w-72 h-72 rounded-full bg-secondary-400/12 blur-3xl" />

      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1 -ml-1" aria-label="Kembali">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-bold text-gray-900 dark:text-white">Tempat Tersimpan</h1>
        <button onClick={() => openAdd()} className="p-1.5 rounded-xl text-white gradient-primary shadow-sm" aria-label="Tambah tempat">
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="relative max-w-2xl mx-auto px-4 pt-4">
        {/* Hero summary */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl gradient-primary text-white p-5 mb-4 shadow-lg"
        >
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="relative flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">Koleksi tempatmu</div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-4xl font-black leading-none tabular-nums">{places.length}</span>
                <span className="text-sm text-white/80 font-semibold">tempat tersimpan</span>
              </div>
              <div className="text-[11px] text-white/70 mt-1">{presentCats.length - 1} kategori · tersinkron ke cloud</div>
            </div>
            <Sparkles className="w-9 h-9 text-white/30" />
          </div>
          {cleanest && (
            <div className="relative mt-3 flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
              <Wind className="w-4 h-4 text-white shrink-0" />
              <span className="text-xs font-medium truncate">
                Udara terbersih: <b>{cleanest.place.name}</b> · AQI {cleanest.aqi}
              </span>
            </div>
          )}
        </motion.div>

        {/* Quick tiles: Home & Work */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {([['home', home, Home, 'Rumah'], ['work', work, Briefcase, 'Kantor']] as const).map(([key, place, Icon, label]) => (
            <button
              key={key}
              onClick={() => place ? goNavigate(place) : openAdd(key)}
              className="glass-card glass-card-hover p-3 flex items-center gap-3 text-left transition"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${place ? `bg-gradient-to-br ${catCfg(key).grad}` : 'bg-gray-100 dark:bg-gray-800'}`}>
                <Icon className={`w-5 h-5 ${place ? 'text-white' : 'text-gray-400'}`} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-gray-900 dark:text-white">{label}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                  {place ? (place.address || 'Tersimpan') : 'Belum diset · ketuk'}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl glass-card mb-3">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari tempat tersimpan…"
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
          />
          {query && <button onClick={() => setQuery('')}><X className="w-4 h-4 text-gray-400" /></button>}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1 mb-3 text-[11px] font-semibold">
          <span className="text-gray-400 mr-1">Urut:</span>
          {([['recent', 'Terbaru'], ['nearest', 'Terdekat'], ['cleanest', 'Udara bersih']] as const).map(([key, label]) => {
            const active = sort === key;
            const disabled = key === 'nearest' && !userLocation;
            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => setSort(key)}
                className={`px-2.5 py-1 rounded-full transition ${
                  active ? 'gradient-primary text-white shadow-sm'
                  : disabled ? 'text-gray-300 dark:text-gray-600'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Category filter */}
        {presentCats.length > 2 && (
          <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide -mx-1 px-1">
            {presentCats.map((cat) => {
              const cfg = CATEGORY_CONFIG[cat];
              const Icon = cfg?.icon;
              const active = filter === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                    active ? 'gradient-primary text-white shadow-sm'
                    : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {Icon ? <Icon className="w-3.5 h-3.5" /> : null}
                  {cat === 'all' ? 'Semua' : (cfg?.label ?? cat)}
                </button>
              );
            })}
          </div>
        )}

        {/* List */}
        {visible.length === 0 ? (
          <div className="glass-card p-8 flex flex-col items-center text-center gap-2 mt-2">
            <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              <MapPin className="w-7 h-7 text-primary-500" />
            </div>
            <div className="text-sm font-bold text-gray-900 dark:text-white">
              {places.length === 0 ? 'Belum ada tempat tersimpan' : 'Tidak ada yang cocok'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 max-w-[240px]">
              {places.length === 0 ? 'Simpan lokasi favoritmu untuk navigasi cepat & pantau kualitas udaranya.' : 'Coba ubah pencarian atau filter kategori.'}
            </div>
            {places.length === 0 && (
              <button onClick={() => openAdd()} className="mt-2 px-4 py-2 rounded-xl gradient-primary text-white text-xs font-semibold">
                Tambah Tempat Pertama
              </button>
            )}
          </div>
        ) : (
          <motion.div
            className="space-y-3" initial="hidden" animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035 } } }}
          >
            <AnimatePresence initial={false}>
              {visible.map((place) => {
                const cfg = catCfg(place.category);
                const dist = userLocation ? distanceKm(userLocation, place.coordinate) : null;
                return (
                  <motion.div
                    key={place.id} layout
                    variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    className="rounded-2xl bg-white/80 dark:bg-gray-900/70 backdrop-blur-xl border border-white/50 dark:border-white/5 shadow-sm overflow-hidden"
                  >
                    <div className={`h-1 bg-gradient-to-r ${cfg.grad}`} />
                    <div className="p-3.5">
                      <div className="flex items-start gap-3">
                        <CatEmblem category={place.category} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{place.name}</h4>
                            <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                              {cfg.label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {place.address || `${place.coordinate.lat.toFixed(4)}, ${place.coordinate.lng.toFixed(4)}`}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <AqiBadge data={aqiMap[place.id]} pending={pending} />
                            {dist !== null && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                                <Navigation2 className="w-2.5 h-2.5" /> {fmtDist(dist)}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                              <Clock className="w-2.5 h-2.5" /> {timeAgo(place.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/50">
                        <button
                          onClick={() => goNavigate(place)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl gradient-primary text-white text-xs font-bold shadow-sm hover:opacity-90 transition"
                        >
                          <Navigation2 className="w-3.5 h-3.5" /> Rute
                        </button>
                        <button
                          onClick={() => share(place)}
                          className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
                        >
                          <Share2 className="w-3.5 h-3.5" /> Bagikan
                        </button>
                        <button
                          onClick={() => removePlace(place.id)}
                          className="flex items-center justify-center p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
                          aria-label="Hapus"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Add sheet */}
      <AnimatePresence>
        {showAdd && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAdd(false)}
              className="fixed inset-0 z-40 bg-black/50"
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 z-50 glass-sheet p-5 pb-8 max-w-2xl mx-auto will-change-transform"
            >
              <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600 mx-auto mb-4" />
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center">
                  <LocateFixed className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Simpan Lokasi Saat Ini</h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Pakai GPS-mu sebagai titik tersimpan</p>
                </div>
              </div>

              <input
                autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="Nama tempat (mis. Rumah, Kantor, Gym)"
                className="w-full bg-gray-50 dark:bg-gray-800 rounded-xl px-3.5 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none border border-gray-200 dark:border-gray-700/50 focus:border-primary-500 mb-3"
              />

              <div className="grid grid-cols-4 gap-2 mb-4 max-h-[168px] overflow-y-auto scrollbar-hide">
                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  const active = newCat === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setNewCat(key as CatKey)}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-[10px] font-semibold transition ${
                        active ? 'gradient-primary text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={saveCurrent} disabled={!newName.trim() || saving}
                className="w-full py-3 rounded-xl gradient-primary text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <LocateFixed className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
                {saving ? 'Mengambil lokasi…' : 'Simpan Lokasi'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNavigation />
    </div>
  );
}
