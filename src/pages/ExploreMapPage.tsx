import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../types';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Wind, Route, Gauge, MapPin, Crosshair, ArrowRight } from 'lucide-react';
import { Seo } from '../components/Seo';
import OpenAppLink from '../components/auth/OpenAppLink';
import Rincian from '../components/viz/Rincian';
import LaporButton from '../components/lapor/LaporButton';
import { useMapStore } from '../stores/mapStore';
import { useIsDark } from '../stores/settingsStore';
import AQICard from '../components/features/AQICard';
import SearchBar from '../components/map/SearchBar';
import { CITIES } from '../lib/cities';
import TrafficLegend from '../components/map/TrafficLegend';
import HargaLegend from '../components/map/HargaLegend';
import WalkRouteCards from '../components/map/WalkRouteCards';
import SchoolPicker from '../components/map/SchoolPicker';
import type { RouteDest, WalkRoutingState } from '../components/map/WalkRouteLayer';
import type { PollutantType, RoadDisplayMode } from '../types';
import { ISPU_CATEGORIES } from '../lib/ispu';
import { FIELD_REGIONS, pickRegion, rememberRegion } from '../lib/field/source';
import FieldAgeNote from '../components/map/FieldAgeNote';
import { parseDestLink, parseRouteLink, parseViewLink } from '../lib/route/share';
import { locationStart } from '../lib/route/appRoute';
import { parseDepart } from '../lib/route/depart';
import { totalModeNote } from '../lib/roadColors';
import { noteRouteLookup } from '../lib/trial/storage';

const FIELD_STATIC = import.meta.env.VITE_FIELD_STATIC === 'true';

// Lazy map (leaflet ~185KB) — progressive enhancement for real browsers; crawlers
// read the prerendered text below. The whole map stack is auth-free.
const LeafletMap = lazy(() => import('../components/map/LeafletMap'));

// F1-13: start the slow parts of the first colored map as soon as this page's code runs: the connection to the field
// CDN and the vector-tile script that the map chunk would otherwise request only after it loads.
if (typeof document !== 'undefined' && import.meta.env.VITE_FIELD_STATIC === 'true') {
  const add = (rel: string, href: string, as?: string, cross = false) => {
    if (document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = rel; l.href = href;
    if (as) l.as = as;
    if (cross) l.crossOrigin = '';
    document.head.appendChild(l);
  };
  const base = (import.meta.env.VITE_FIELD_BASE as string | undefined)?.replace(/\/$/, '');
  if (base && /^https:/.test(base)) add('preconnect', new URL(base).origin, undefined, true);
  add('preload', '/vendor/leaflet-vectorgrid.js', 'script');
  void import('../components/map/LeafletMap');
}

// ISPU categories (Permen LHK P.14/2020, Lampiran II) for the index view.
const AQI_LEGEND = ISPU_CATEGORIES.map((c) => ({ label: `${c.name} (${c.range})`, color: c.color }));

// Pollutant + road-resolution controls (mirrors the main map's layer menu).
// Defined locally so this page does NOT statically import RoadPollutionLayer
// (which pulls leaflet) — keeps the map chunk lazy.
const POLLUTANTS: { id: PollutantType; label: string; unit: string }[] = [
  { id: 'aqi', label: 'ISPU', unit: '' },
  { id: 'pm25', label: 'PM₂.₅', unit: 'µg/m³' },
  { id: 'no2', label: 'NO₂', unit: 'µg/m³' },
  { id: 'o3', label: 'O₃', unit: 'µg/m³' },
  { id: 'pm10', label: 'PM₁₀', unit: 'µg/m³' },
];
const ROAD_MODES: [RoadDisplayMode, string][] = [['traffic', 'Asap kendaraan'], ['total', 'Udara total'], ['harga', 'Harga hirup']];
const RAMP = 'linear-gradient(90deg,#00E400,#FFFF00,#FF7E00,#FF0000,#8F3F97,#7E0023)';

const HOW = [
  { Icon: Wind, title: 'Asap kendaraan per ruas jalan', desc: 'Dihitung ulang tiap jam dari lalu lintas, angin, dan sensor warga untuk tiap ruas jalan di Badung–Denpasar dan Kota Bogor, bukan satu angka untuk seluruh kota.' },
  { Icon: Route, title: 'Rute yang jujur', desc: 'Rute tercepat dan rute paling sedikit asap, dengan menit tambahan dan persen asap yang berkurang; rute motor juga menunjukkan asap yang ditimbulkan bagi orang lain.' },
  { Icon: Gauge, title: 'Dosis paparan nyata', desc: 'Hitung PM2.5 yang benar-benar kamu hirup berdasarkan usia, aktivitas, dan moda perjalanan.' },
];

export default function ExploreMapPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isRoot = location.pathname === '/';
  // ?wilayah=kota_bogor opens the map in that field region (for the demo in Bogor).
  // ?rute=lat,lng~lat,lng[&moda=motor] opens with that on-device route (route links, share.ts).
  const [link] = useState(() => parseRouteLink(location.search));
  // ?sekolah=lat,lng,name (from /prioritas): routing on with that destination (F1-14)
  const [destParam] = useState(() => parseDestLink(location.search));
  // ?pusat=lat,lng,zoom opens the map at that view (QA screenshots, demo links)
  const [view] = useState(() => parseViewLink(location.search));
  const anchor = link ? link.from : destParam ?? view;
  const startRegion = anchor
    ? FIELD_REGIONS.find((r) => r.bounds[0][0] <= anchor.lat && anchor.lat <= r.bounds[1][0] && r.bounds[0][1] <= anchor.lng && anchor.lng <= r.bounds[1][1]) ?? pickRegion(null)
    : pickRegion(new URLSearchParams(location.search).get('wilayah'));
  const regionFromLink = !!anchor || new URLSearchParams(location.search).has('wilayah');
  const [region, setRegion] = useState(startRegion.name);
  const isDark = useIsDark();
  const currentAQI = useMapStore((s) => s.currentAQI);
  // The value card follows the map: field reading for the centre when the area has a field, else the API.
  const onViewChange = useCallback((c: Coordinate) => { void useMapStore.getState().fetchAreaReading(c); }, []);
  const [located, setLocated] = useState(false);
  const [pollutant, setPollutant] = useState<PollutantType>('aqi');
  // exhaust first: in the total view every road of a town has nearly the same colour (the background dominates)
  const [roadDisplayMode, setRoadDisplayMode] = useState<RoadDisplayMode>('traffic');
  const [walkMode, setWalkMode] = useState(!!link || !!destParam);
  const [walkState, setWalkState] = useState<WalkRoutingState | null>(null);
  const [routeMode, setRouteMode] = useState<'walk' | 'motor'>(link?.mode ?? 'walk');
  // the student trial diary (F4-07): counts a route lookup only while the student turned it on at /uji-coba; the mode
  // is read from a ref so a mode switch is recorded with the recomputed cards, not the old ones
  const modeRef = useRef(routeMode);
  useEffect(() => { modeRef.current = routeMode; }, [routeMode]); // runs before the effect below in the same commit
  useEffect(() => {
    if (walkState?.cards.length) noteRouteLookup(walkState.cards, modeRef.current, walkState.ends?.from);
  }, [walkState]);
  // "Ke sekolah": a school chosen from the list is the destination, the next tap the start (F1-12)
  const [schoolDest, setSchoolDest] = useState<RouteDest | null>(() => destParam);
  // departure for the school zone: ?berangkat=HH:MM, or the choice on the route cards (F3-08)
  const [depart, setDepart] = useState<string | null>(() => parseDepart(new URLSearchParams(location.search).get('berangkat')));
  // "Pakai lokasiku" while routing: the phone's position is the start towards the chosen school (F3-14)
  const userLocation = useMapStore((s) => s.userLocation);
  const locationError = useMapStore((s) => s.locationError);
  const fromHere = locationStart(located ? userLocation : null, schoolDest, located ? locationError : null);
  const activeP = POLLUTANTS.find((p) => p.id === pollutant) ?? POLLUTANTS[0];
  // The traffic view of the index shows NO2, and harga hirup does not depend on the pollutant: modes for every pollutant.
  const showRoadModes = true;

  // Start where coloured roads exist: with the static field, its first region (Badung-Denpasar); otherwise Jakarta.
  // No geolocation prompt.
  useEffect(() => {
    const start = view && !link && !destParam ? { lat: view.lat, lng: view.lng } : FIELD_STATIC ? startRegion.home : { lat: -6.2088, lng: 106.8456 };
    // a region named by the link (?wilayah, a route or a school) is also where the app map starts next time (F1-52)
    if (FIELD_STATIC && regionFromLink) rememberRegion(startRegion.name);
    useMapStore.getState().setCenter(start);
    void useMapStore.getState().fetchAreaReading(start);
  }, [startRegion, regionFromLink, view, link, destParam]);

  const useMyLocation = () => {
    setLocated(true);
    useMapStore.getState().startLocating(); // opt-in geolocation (sets center + AQI)
  };

  return (
    <div className="gradient-mesh-bg min-h-screen pb-16">
      <Seo
        title="Peta Udara Langsung — Asap Kendaraan per Jalan & Rute Bersih | Breeva"
        description="Peta asap kendaraan dan kualitas udara per ruas jalan untuk Badung–Denpasar dan Kota Bogor, dihitung ulang tiap jam; rute jalan kaki dengan asap paling sedikit dihitung di ponsel. Kota lain: kualitas udara kota. Gratis, tanpa login."
        path="/peta"
      />

      {/* Header */}
      <div className="sticky top-0 z-30 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
        {!isRoot && (
          <button onClick={() => navigate('/')} aria-label="Kembali" className="text-gray-600 dark:text-gray-300 p-1 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">{isRoot ? 'Breeva · Peta Udara Langsung' : 'Peta Udara Langsung'}</h1>
        {isRoot && <Link to="/landing" className="ml-2 text-xs text-gray-500 dark:text-gray-400 underline-offset-2 hover:underline">Tentang</Link>}
        <LaporButton className="ml-auto" getCenter={() => useMapStore.getState().center ?? null} />
        <OpenAppLink className="text-xs font-semibold px-3 py-1.5 rounded-full gradient-primary text-white shadow-sm">Buka aplikasi</OpenAppLink>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-5">
        {/* Hero copy (real, crawlable content) */}
        <header>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white leading-snug">Asap kendaraan per ruas jalan</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold" aria-label="Ringkasan">
            <span className="rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 text-emerald-800 dark:text-emerald-300">diperbarui tiap jam</span>
            <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-gray-700 dark:text-gray-200">ketuk jalan untuk angkanya</span>
            <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-gray-700 dark:text-gray-200">tanpa akun</span>
          </div>
          <Rincian summary="Apa yang dihitung?" className="mt-2">
            <p>
              Untuk tiap ruas jalan, Breeva menghitung asap kendaraan dari perkiraan lalu lintas jam itu, angin, dan rumus sebaran
              panduan EPA, di atas udara latar dari sensor warga (OpenAQ) dan CAMS. Nilainya perkiraan model, lengkap dengan rentang
              95%. Wilayah tanpa titik ukur diberi label indikatif.
            </p>
          </Rincian>
        </header>

        {/* Layer controls — pollutant type + road resolution (mirrors main map) */}
        <div className="glass-card p-4 space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Jenis polusi</p>
            <div className="flex flex-wrap gap-2">
              {POLLUTANTS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPollutant(p.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
                    pollutant === p.id
                      ? 'gradient-primary text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {showRoadModes && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Resolusi jalan</p>
              <div className="flex flex-wrap gap-2">
                {ROAD_MODES.map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setRoadDisplayMode(m)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
                      roadDisplayMode === m
                        ? 'bg-sky-700 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Rincian summary="Arti tiap mode" className="mt-2">
                <p><b>Asap kendaraan</b>: gas buang dan jelaga dari kendaraan di ruas itu dan sekitarnya; inilah yang berbeda antara jalan ramai dan gang, dan yang bisa dihindari lewat pilihan jalan.</p>
                <p className="mt-1"><b>Udara total</b>: PM2,5 dan ISPU, hampir sama di seluruh kota karena didominasi udara latar.</p>
                <p className="mt-1"><b>Harga hirup</b>: seberapa banyak orang menghirup gas buang ruas itu.</p>
              </Rincian>
            </div>
          )}
        </div>

        {/* Field regions: jump to one */}
        {FIELD_STATIC && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Wilayah">
            {FIELD_REGIONS.map((r) => (
              <button key={r.name} aria-pressed={region === r.name}
                onClick={() => { setRegion(r.name); rememberRegion(r.name); setSchoolDest(null); useMapStore.getState().setCenter(r.home); void useMapStore.getState().fetchAreaReading(r.home); }}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${region === r.name ? 'bg-sky-700 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                {r.label}
              </button>
            ))}
          </div>
        )}

        {/* Interactive map (progressive enhancement) */}
        {/* peta-tombol-kiri: the attribution keeps clear of the bottom-left route button (index.css, X-W52) */}
        <div className={`relative rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-700/40 shadow-lg${FIELD_STATIC ? ' peta-tombol-kiri' : ''}`} style={{ height: 'min(58vh, 480px)' }}>
          <Suspense fallback={<div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 animate-pulse" />}>
            <LeafletMap className="absolute inset-0" isDarkMode={isDark} showAQIOverlay showAQIStations showPOIs={false} mapStyle="voyager" onViewChange={onViewChange} pollutant={pollutant} roadDisplayMode={roadDisplayMode} walkRouting={walkMode} onWalkRouting={setWalkState} routeMode={routeMode} routeLink={link} routeDest={schoolDest} routeDepart={depart} routeStart={walkMode ? fromHere.start : null} wheelNeedsModifier initialCenter={view && !link && !destParam ? view : FIELD_STATIC ? startRegion.home : undefined} initialZoom={view && !link && !destParam ? view.zoom : undefined} />
          </Suspense>

          {/* Search overlay */}
          <div className="absolute top-3 left-3 right-3 z-[500]">
            <SearchBar />
          </div>

          {/* Walking routes computed on the device (static field regions) */}
          {FIELD_STATIC && (
            <button
              onClick={() => { setWalkMode((m) => !m); setWalkState(null); setSchoolDest(null); }}
              aria-pressed={walkMode}
              className={`absolute left-3 bottom-3 z-[500] flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-lg ring-1 ring-black/5 ${walkMode ? 'bg-teal-700 text-white' : 'bg-white/95 dark:bg-gray-900/90 text-teal-700 dark:text-teal-300'}`}
            >
              <Route className="w-3.5 h-3.5" /> {walkMode ? 'Selesai rute' : 'Rute di perangkat'}
            </button>
          )}

          {/* Use-my-location (opt-in) */}
          {!located && (
            <button onClick={useMyLocation} className="absolute right-3 top-[4.25rem] z-[500] flex items-center gap-1.5 rounded-full bg-white/95 dark:bg-gray-900/90 px-3 py-2 text-xs font-semibold text-primary-700 dark:text-primary-300 shadow-lg ring-1 ring-black/5">
              <Crosshair className="w-3.5 h-3.5" /> Pakai lokasiku
            </button>
          )}
        </div>

        {walkMode && (
          <div className="space-y-2">
            <SchoolPicker region={pickRegion(region)} value={schoolDest} onChange={setSchoolDest} />
            {fromHere.note && <p className="text-[12px] text-teal-800 dark:text-teal-300">{fromHere.note}</p>}
            <WalkRouteCards state={walkState} mode={routeMode} onMode={setRouteMode} depart={depart} onDepart={setDepart} />
          </div>
        )}

        {/* Live AQI card, below the map so the map's data attribution stays visible */}
        {currentAQI && <AQICard data={currentAQI} />}

        {/* Legend — reflects the selected pollutant / road mode */}
        <div className="glass-card p-4">
          {FIELD_STATIC && <FieldAgeNote region={region} className="mb-2" />}
          <p className="text-xs font-semibold text-gray-900 dark:text-white mb-2.5">
            Arti warna jalan — {activeP.label}
            {roadDisplayMode === 'traffic' ? ' · asap kendaraan' : roadDisplayMode === 'harga' ? ' · harga hirup' : ''}
          </p>
          {roadDisplayMode === 'traffic' ? (
            <TrafficLegend pollutant={pollutant} />
          ) : roadDisplayMode === 'harga' ? (
            <HargaLegend />
          ) : pollutant === 'aqi' ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {AQI_LEGEND.map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full" style={{ background: l.color }} />
                  <span className="text-[11px] text-gray-600 dark:text-gray-300">{l.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className="h-2.5 rounded-full" style={{ background: RAMP }} />
              <div className="flex justify-between mt-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                <span>Rendah</span>
                <span>{roadDisplayMode === 'total' ? `Konsentrasi ${activeP.unit}` : 'Kontribusi lalu lintas'}</span>
                <span>Tinggi</span>
              </div>
              {roadDisplayMode === 'total' && totalModeNote(pollutant) && (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-amber-800 dark:text-amber-300">{totalModeNote(pollutant)}</p>
              )}
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Seberapa akurat? <Link to="/validasi" className="font-semibold text-sky-700 dark:text-sky-300 underline">Cara kami menguji akurasi</Link> ·{' '}
          <Link to="/prioritas" className="font-semibold text-sky-700 dark:text-sky-300 underline">Prioritas sekolah dan faskes</Link>
        </p>

        {/* How it works (folded: N-04) */}
        <Rincian summary="Cara kerja">
          <div className="grid sm:grid-cols-3 gap-3">
            {HOW.map((h) => (
              <div key={h.title} className="glass-card p-4">
                <h.Icon className="w-5 h-5 text-primary-500 mb-2" />
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{h.title}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{h.desc}</p>
              </div>
            ))}
          </div>
        </Rincian>

        {/* City grid — internal links so crawlers reach every /udara/* page in one hop */}
        <section>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-primary-500" /> Udara per kota
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {CITIES.map((c) => (
              <Link key={c.slug} to={`/udara/${c.slug}`} className="glass-card px-3 py-2.5 text-center hover:ring-1 hover:ring-primary-400/40 transition">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">{c.name}</span>
                <span className="block text-[10px] text-gray-400 dark:text-gray-500">Lihat AQI</span>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="grid sm:grid-cols-2 gap-3">
          <Link to="/paparan" className="glass-card p-4 flex items-center gap-3 hover:ring-1 hover:ring-primary-400/40 transition">
            <Gauge className="w-5 h-5 text-primary-500 shrink-0" />
            <span className="flex-1"><span className="block text-sm font-semibold text-gray-900 dark:text-white">Kalkulator Paparan</span><span className="block text-[11px] text-gray-500 dark:text-gray-400">Hitung dosis PM2.5 di sebuah rute</span></span>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </Link>
          <OpenAppLink className="rounded-2xl p-4 flex items-center gap-3 gradient-primary text-white shadow-lg shadow-primary-500/20">
            <Route className="w-5 h-5 shrink-0" />
            <span className="flex-1"><span className="block text-sm font-semibold">Buka aplikasi penuh</span><span className="block text-[11px] text-white/85">Rute bersih, lacak jalan, EcoPoin</span></span>
            <ArrowRight className="w-4 h-4" />
          </OpenAppLink>
        </section>

        {/* Footer nav (internal links for crawlers) */}
        <nav className="flex flex-wrap gap-x-4 pt-2 text-[11px] text-gray-500 dark:text-gray-400">
          <Link to="/" className="inline-flex min-h-6 items-center hover:text-primary-500">Beranda</Link>
          <Link to="/paparan" className="inline-flex min-h-6 items-center hover:text-primary-500">Kalkulator Paparan</Link>
          <Link to="/about" className="inline-flex min-h-6 items-center hover:text-primary-500">Tentang</Link>
          <Link to="/eco-tips" className="inline-flex min-h-6 items-center hover:text-primary-500">Tips Udara Bersih</Link>
        </nav>
      </div>
    </div>
  );
}
