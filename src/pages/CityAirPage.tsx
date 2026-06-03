import { lazy, Suspense, useEffect } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Wind, Gauge, Route, ArrowRight, MapPin } from 'lucide-react';
import { Seo } from '../components/Seo';
import { useMapStore } from '../stores/mapStore';
import { useIsDark } from '../stores/settingsStore';
import AQICard from '../components/features/AQICard';
import { CITY_BY_SLUG, CITIES } from '../lib/cities';

const LeafletMap = lazy(() => import('../components/map/LeafletMap'));

export default function CityAirPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const isDark = useIsDark();
  const currentAQI = useMapStore((s) => s.currentAQI);
  const city = slug ? CITY_BY_SLUG[slug] : undefined;

  useEffect(() => {
    if (!city) return;
    useMapStore.getState().setCenter({ lat: city.lat, lng: city.lng });
    useMapStore.getState().fetchAirQuality({ lat: city.lat, lng: city.lng });
  }, [city]);

  if (!city) return <Navigate to="/peta" replace />;

  const others = CITIES.filter((c) => c.slug !== city.slug);

  return (
    <div className="gradient-mesh-bg min-h-screen pb-16">
      <Seo
        title={`Kualitas Udara ${city.name} Hari Ini — AQI per Jalan | Breeva`}
        description={`Pantau kualitas udara (AQI) dan PM2.5 per ruas jalan di ${city.name}, ${city.region}, real-time. ${city.blurb} Temukan rute jalan kaki paling bersih — gratis di Breeva.`}
        path={`/udara/${city.slug}`}
      />

      {/* Header */}
      <div className="sticky top-0 z-30 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
        <button onClick={() => navigate('/peta')} aria-label="Kembali" className="text-gray-600 dark:text-gray-300 p-1 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Udara {city.name}</h1>
        <Link to="/login" className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-full gradient-primary text-white shadow-sm">Buka aplikasi</Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-5">
        {/* Hero copy (real, crawlable) */}
        <header>
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary-600 dark:text-primary-400">{city.region}</p>
          <h2 className="mt-1.5 text-2xl font-extrabold text-gray-900 dark:text-white leading-snug">
            Kualitas udara {city.name} hari ini
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {city.blurb} Breeva memetakan AQI (Indeks Kualitas Udara) dan PM2.5 untuk <b>tiap ruas jalan</b> di {city.name}
            {' '}secara real-time lewat mesin VAYU, lalu mencarikan rute jalan kaki paling bersih. Geser peta untuk melihat
            warna polusi per jalan; bebas dipakai tanpa akun.
          </p>
        </header>

        {/* Live map centered on the city */}
        <div className="relative rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-700/40 shadow-lg" style={{ height: 'min(54vh, 440px)' }}>
          <Suspense fallback={<div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 animate-pulse" />}>
            <LeafletMap className="absolute inset-0" isDarkMode={isDark} showAQIOverlay showAQIStations showPOIs={false} mapStyle="voyager" />
          </Suspense>
          {currentAQI && (
            <div className="absolute bottom-3 left-3 right-3 z-[500]">
              <AQICard data={currentAQI} />
            </div>
          )}
        </div>

        {/* Quick facts */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { Icon: Wind, label: 'AQI per jalan', val: 'Real-time' },
            { Icon: Route, label: 'Rute bersih', val: '3 opsi' },
            { Icon: Gauge, label: 'Paparan PM2.5', val: 'Per rute' },
          ].map((f) => (
            <div key={f.label} className="glass-card p-3 text-center">
              <f.Icon className="w-4 h-4 text-primary-500 mx-auto mb-1" />
              <p className="text-sm font-bold text-gray-900 dark:text-white">{f.val}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{f.label}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <section className="grid sm:grid-cols-2 gap-3">
          <Link to="/paparan" className="glass-card p-4 flex items-center gap-3 hover:ring-1 hover:ring-primary-400/40 transition">
            <Gauge className="w-5 h-5 text-primary-500 shrink-0" />
            <span className="flex-1"><span className="block text-sm font-semibold text-gray-900 dark:text-white">Kalkulator Paparan</span><span className="block text-[11px] text-gray-500 dark:text-gray-400">Hitung dosis PM2.5 yang kamu hirup</span></span>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </Link>
          <Link to="/peta" className="glass-card p-4 flex items-center gap-3 hover:ring-1 hover:ring-primary-400/40 transition">
            <MapPin className="w-5 h-5 text-primary-500 shrink-0" />
            <span className="flex-1"><span className="block text-sm font-semibold text-gray-900 dark:text-white">Peta udara langsung</span><span className="block text-[11px] text-gray-500 dark:text-gray-400">Semua kota dalam satu peta</span></span>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </Link>
        </section>

        {/* Other cities — internal links */}
        <section>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Kota lain</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {others.map((c) => (
              <Link key={c.slug} to={`/udara/${c.slug}`} className="glass-card px-3 py-2.5 text-center hover:ring-1 hover:ring-primary-400/40 transition">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">{c.name}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
