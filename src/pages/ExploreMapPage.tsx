import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, Wind, Route, Gauge, MapPin, Crosshair, ArrowRight, Sparkles } from 'lucide-react';
import { Seo } from '../components/Seo';
import { useMapStore } from '../stores/mapStore';
import { useIsDark } from '../stores/settingsStore';
import AQICard from '../components/features/AQICard';
import SearchBar from '../components/map/SearchBar';
import { CITIES } from '../lib/cities';
import type { PollutantType, RoadDisplayMode } from '../types';

// Lazy map (leaflet ~185KB) — progressive enhancement for real browsers; crawlers
// read the prerendered text below. The whole map stack is auth-free.
const LeafletMap = lazy(() => import('../components/map/LeafletMap'));

const AQI_LEGEND = [
  { label: 'Baik (0–50)', color: '#22c55e' },
  { label: 'Sedang (51–100)', color: '#eab308' },
  { label: 'Tidak sehat (101–150)', color: '#f97316' },
  { label: 'Buruk (151–200)', color: '#ef4444' },
  { label: 'Sangat buruk (201+)', color: '#a855f7' },
];

// Pollutant + road-resolution controls (mirrors the main map's layer menu).
// Defined locally so this page does NOT statically import RoadPollutionLayer
// (which pulls leaflet) — keeps the map chunk lazy.
const POLLUTANTS: { id: PollutantType; label: string; unit: string }[] = [
  { id: 'aqi', label: 'AQI', unit: '' },
  { id: 'pm25', label: 'PM₂.₅', unit: 'µg/m³' },
  { id: 'no2', label: 'NO₂', unit: 'µg/m³' },
  { id: 'o3', label: 'O₃', unit: 'µg/m³' },
  { id: 'pm10', label: 'PM₁₀', unit: 'µg/m³' },
];
const ROAD_MODES: [RoadDisplayMode, string][] = [['total', 'Absolut'], ['delta', 'Δ Jalan'], ['contrast', 'Kontras']];
const CONCENTRATION = ['pm25', 'no2', 'pm10'];
const RAMP = 'linear-gradient(90deg,#00E400,#FFFF00,#FF7E00,#FF0000,#8F3F97,#7E0023)';

const HOW = [
  { Icon: Wind, title: 'AQI per ruas jalan', desc: 'Mesin VAYU mengkalibrasi kualitas udara untuk tiap segmen jalan — bukan satu angka untuk seluruh kota.' },
  { Icon: Route, title: 'Rute sadar-polusi', desc: 'Tiga pilihan rute — Bersih, Seimbang, Cepat — masing-masing diberi skor udara dan estimasi paparan.' },
  { Icon: Gauge, title: 'Dosis paparan nyata', desc: 'Hitung PM2.5 yang benar-benar kamu hirup berdasarkan usia, aktivitas, dan moda perjalanan.' },
];

export default function ExploreMapPage() {
  const navigate = useNavigate();
  const isDark = useIsDark();
  const currentAQI = useMapStore((s) => s.currentAQI);
  const [located, setLocated] = useState(false);
  const [pollutant, setPollutant] = useState<PollutantType>('aqi');
  const [roadDisplayMode, setRoadDisplayMode] = useState<RoadDisplayMode>('total');
  const activeP = POLLUTANTS.find((p) => p.id === pollutant) ?? POLLUTANTS[0];
  const showRoadModes = CONCENTRATION.includes(pollutant);

  // Populate AQI for the default city (Jakarta) WITHOUT prompting for geolocation.
  useEffect(() => {
    useMapStore.getState().fetchAirQuality({ lat: -6.2088, lng: 106.8456 });
  }, []);

  const useMyLocation = () => {
    setLocated(true);
    useMapStore.getState().startLocating(); // opt-in geolocation (sets center + AQI)
  };

  return (
    <div className="gradient-mesh-bg min-h-screen pb-16">
      <Seo
        title="Peta Udara Langsung — AQI per Jalan & Rute Bersih Indonesia | Breeva"
        description="Peta kualitas udara (AQI) real-time per ruas jalan untuk Jakarta, Bali, Bandung, Surabaya & kota Indonesia. Temukan rute jalan kaki paling bersih dan hitung paparan PM2.5 — gratis, tanpa login."
        path="/peta"
      />

      {/* Header */}
      <div className="sticky top-0 z-30 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
        <button onClick={() => navigate('/')} aria-label="Kembali" className="text-gray-600 dark:text-gray-300 p-1 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Peta Udara Langsung</h1>
        <Link to="/login" className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-full gradient-primary text-white shadow-sm">Buka aplikasi</Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-5">
        {/* Hero copy (real, crawlable content) */}
        <header>
          <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-bold text-primary-600 dark:text-primary-400">
            <Sparkles className="w-3.5 h-3.5" /> Mesin VAYU · Data publik
          </div>
          <h2 className="mt-1.5 text-2xl font-extrabold text-gray-900 dark:text-white leading-snug">
            Kualitas udara per jalan, langsung di peta
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            Breeva memetakan AQI (Indeks Kualitas Udara) untuk <b>tiap ruas jalan</b> di kota-kota Indonesia secara
            real-time — memakai mesin VAYU yang mengkalibrasi data sensor, satelit, dan dispersi lalu lintas.
            Jelajahi peta di bawah, lihat warna polusi per jalan, lalu temukan rute jalan kaki paling bersih.
            Bebas dipakai tanpa akun.
          </p>
        </header>

        {/* Layer controls — pollutant type + road resolution (mirrors main map) */}
        <div className="glass-card p-4 space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Jenis polusi</p>
            <div className="flex flex-wrap gap-2">
              {POLLUTANTS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setPollutant(p.id); if (!CONCENTRATION.includes(p.id)) setRoadDisplayMode('total'); }}
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
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2 leading-relaxed">
                <b>Absolut</b>: konsentrasi total vs ambang WHO/EPA. <b>Δ Jalan</b> &amp; <b>Kontras</b>: menonjolkan kontribusi lalu lintas per ruas jalan (dispersi CALINE).
              </p>
            </div>
          )}
        </div>

        {/* Interactive map (progressive enhancement) */}
        <div className="relative rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-700/40 shadow-lg" style={{ height: 'min(58vh, 480px)' }}>
          <Suspense fallback={<div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 animate-pulse" />}>
            <LeafletMap className="absolute inset-0" isDarkMode={isDark} showAQIOverlay showAQIStations showPOIs={false} mapStyle="voyager" pollutant={pollutant} roadDisplayMode={roadDisplayMode} />
          </Suspense>

          {/* Search overlay */}
          <div className="absolute top-3 left-3 right-3 z-[500]">
            <SearchBar />
          </div>

          {/* Use-my-location (opt-in) */}
          {!located && (
            <button onClick={useMyLocation} className="absolute right-3 z-[500] flex items-center gap-1.5 rounded-full bg-white/95 dark:bg-gray-900/90 px-3 py-2 text-xs font-semibold text-primary-600 dark:text-primary-400 shadow-lg ring-1 ring-black/5" style={{ bottom: currentAQI ? '8.5rem' : '0.75rem' }}>
              <Crosshair className="w-3.5 h-3.5" /> Pakai lokasiku
            </button>
          )}

          {/* Live AQI card */}
          {currentAQI && (
            <div className="absolute bottom-3 left-3 right-3 z-[500]">
              <AQICard data={currentAQI} />
            </div>
          )}
        </div>

        {/* Legend — reflects the selected pollutant / road mode */}
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-gray-900 dark:text-white mb-2.5">
            Arti warna jalan — {activeP.label}
            {showRoadModes && roadDisplayMode !== 'total' && (roadDisplayMode === 'delta' ? ' · Δ jalan' : ' · kontras')}
          </p>
          {pollutant === 'aqi' ? (
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
            </div>
          )}
        </div>

        {/* How it works */}
        <section>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Cara kerja</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            {HOW.map((h) => (
              <div key={h.title} className="glass-card p-4">
                <h.Icon className="w-5 h-5 text-primary-500 mb-2" />
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{h.title}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{h.desc}</p>
              </div>
            ))}
          </div>
        </section>

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
          <Link to="/login" className="rounded-2xl p-4 flex items-center gap-3 gradient-primary text-white shadow-lg shadow-primary-500/20">
            <Route className="w-5 h-5 shrink-0" />
            <span className="flex-1"><span className="block text-sm font-semibold">Buka aplikasi penuh</span><span className="block text-[11px] text-white/85">Rute bersih, lacak jalan, EcoPoin</span></span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>

        {/* Footer nav (internal links for crawlers) */}
        <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[11px] text-gray-400 dark:text-gray-500">
          <Link to="/" className="hover:text-primary-500">Beranda</Link>
          <Link to="/paparan" className="hover:text-primary-500">Kalkulator Paparan</Link>
          <Link to="/about" className="hover:text-primary-500">Tentang</Link>
          <Link to="/developers" className="hover:text-primary-500">Developer API</Link>
          <Link to="/eco-tips" className="hover:text-primary-500">Tips Udara Bersih</Link>
        </nav>
      </div>
    </div>
  );
}
