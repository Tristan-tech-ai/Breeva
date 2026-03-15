import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Play, Pause, Download, RotateCcw, Leaf, Clock, Flame, Share2, Wind, Star, Image } from 'lucide-react';
import { submitAQCalibration } from '../lib/api';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import BottomNavigation from '../components/layout/BottomNavigation';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { formatDistance, formatDuration, formatNumber } from '../lib/utils';

interface WalkDetail {
  id: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  route_polyline: string | null;
  distance_meters: number;
  duration_seconds: number;
  ecopoints_earned: number;
  co2_saved_grams: number;
  avg_aqi: number | null;
  route_type: string | null;
  completed_at: string | null;
  created_at: string;
}

function AnimatedMarker({ positions, index }: { positions: [number, number][]; index: number }) {
  const map = useMap();
  useEffect(() => {
    if (positions[index]) {
      map.panTo(positions[index], { animate: true, duration: 0.3 });
    }
  }, [index, positions, map]);

  if (!positions[index]) return null;
  return (
    <CircleMarker center={positions[index]} radius={6} pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }} />
  );
}

export default function WalkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [walk, setWalk] = useState<WalkDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  // Replay state
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AQ Calibration state
  const [aqRating, setAqRating] = useState<number | null>(null);
  const [aqSubmitted, setAqSubmitted] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('walks')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (data) {
        setWalk(data);
        if (data.route_polyline) {
          try {
            const parsed = JSON.parse(data.route_polyline);
            if (Array.isArray(parsed) && parsed.length >= 2) {
              setRouteCoords(parsed.map((p: { lat: number; lng: number } | [number, number]) =>
                Array.isArray(p) ? p as [number, number] : [p.lat, p.lng]
              ));
            }
          } catch { /* noop */ }
        }
        if (!routeCoords.length && data.origin_lat && data.destination_lat) {
          setRouteCoords([
            [data.origin_lat, data.origin_lng],
            [data.destination_lat, data.destination_lng],
          ]);
        }
      }
      setIsLoading(false);
    })();
  }, [id, user]);

  // Replay controls
  const startReplay = () => {
    if (routeCoords.length < 2) return;
    setIsPlaying(true);
    intervalRef.current = setInterval(() => {
      setReplayIndex(prev => {
        if (prev >= routeCoords.length - 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 100);
  };

  const pauseReplay = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsPlaying(false);
  };

  const resetReplay = () => {
    pauseReplay();
    setReplayIndex(0);
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Share walk stats
  const handleShare = async () => {
    if (!walk) return;
    const text = `🚶 Breeva Walk\n📏 ${formatDistance(walk.distance_meters)}\n⏱ ${formatDuration(walk.duration_seconds)}\n🌱 ${(walk.co2_saved_grams / 1000).toFixed(2)} kg CO₂ saved\n⭐ +${formatNumber(walk.ecopoints_earned)} EcoPoints\n\nTrack your eco-impact at breeva.site`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My Breeva Walk', text });
      } else {
        await navigator.clipboard.writeText(text);
        alert('Walk stats copied to clipboard!');
      }
    } catch { /* cancelled */ }
  };

  // Share walk stats as image card
  const handleShareImage = async () => {
    if (!walk) return;
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 600, 400);
    grad.addColorStop(0, '#10b981');
    grad.addColorStop(1, '#059669');
    ctx.fillStyle = grad;
    ctx.roundRect(0, 0, 600, 400, 20);
    ctx.fill();

    // Title
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('🚶 BREEVA ECO-WALK', 40, 50);

    // Date
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(new Date(walk.completed_at || walk.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), 40, 75);

    // Stats
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillText(formatDistance(walk.distance_meters), 40, 150);

    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Distance', 40, 175);

    // Grid stats
    const stats = [
      { label: 'Duration', value: formatDuration(walk.duration_seconds) },
      { label: 'CO₂ Saved', value: `${(walk.co2_saved_grams / 1000).toFixed(2)} kg` },
      { label: 'EcoPoints', value: `+${formatNumber(walk.ecopoints_earned)}` },
    ];
    stats.forEach((s, i) => {
      const x = 40 + i * 190;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillText(s.value, x, 240);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(s.label, x, 262);
    });

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Track your eco-impact at breeva.site', 40, 370);

    // Convert to blob and share
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], 'breeva-walk.png', { type: 'image/png' });
      try {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'My Breeva Walk' });
        } else {
          // Fallback: download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'breeva-walk.png';
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch { /* cancelled */ }
    }, 'image/png');
  };

  // AQ Calibration
  const handleAQCalibration = async (rating: number) => {
    if (!walk || !user || aqSubmitted) return;
    setAqRating(rating);
    setAqSubmitted(true);
    await submitAQCalibration(walk.id, user.id, rating, walk.origin_lat, walk.origin_lng);
    // Bonus points for calibration
    try {
      await supabase.rpc('add_ecopoints', {
        p_user_id: user.id,
        p_amount: 5,
        p_type: 'aq_calibration',
        p_description: 'Air quality calibration feedback',
      });
    } catch { /* ignore */ }
    useAuthStore.getState().fetchProfile();
  };

  // GPX export
  const exportGPX = () => {
    if (!walk || routeCoords.length < 2) return;
    const points = routeCoords
      .map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
      .join('\n');

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Breeva" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Breeva Walk ${new Date(walk.completed_at || walk.created_at).toLocaleDateString()}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `breeva-walk-${walk.id.slice(0, 8)}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="gradient-mesh-bg min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!walk) {
    return (
      <div className="gradient-mesh-bg min-h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-gray-500 dark:text-gray-400">Walk not found</p>
        <button onClick={() => navigate(-1)} className="text-primary-500 text-sm">Go Back</button>
      </div>
    );
  }

  const center: [number, number] = routeCoords.length > 0
    ? routeCoords[Math.floor(routeCoords.length / 2)]
    : [walk.origin_lat, walk.origin_lng];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Walk Detail</h1>
        <div className="flex items-center gap-1">
          <button onClick={handleShareImage} className="text-primary-500 p-1" title="Share as image">
            <Image className="w-5 h-5" />
          </button>
          <button onClick={handleShare} className="text-primary-500 p-1" title="Share as text">
            <Share2 className="w-5 h-5" />
          </button>
          <button onClick={exportGPX} disabled={routeCoords.length < 2} className="text-primary-500 p-1 disabled:opacity-30" title="Export GPX">
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Date */}
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1">
          {formatDate(walk.completed_at || walk.created_at)}
        </p>

        {/* Map */}
        {routeCoords.length >= 2 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700/30 h-56">
            <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
              <Polyline positions={routeCoords} pathOptions={{ color: '#6366f1', weight: 4, opacity: 0.4 }} />
              {isPlaying || replayIndex > 0 ? (
                <>
                  <Polyline positions={routeCoords.slice(0, replayIndex + 1)} pathOptions={{ color: '#10b981', weight: 4 }} />
                  <AnimatedMarker positions={routeCoords} index={replayIndex} />
                </>
              ) : null}
              {/* Start/End markers */}
              <CircleMarker center={routeCoords[0]} radius={5} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }} />
              <CircleMarker center={routeCoords[routeCoords.length - 1]} radius={5} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />
            </MapContainer>
          </motion.div>
        )}

        {/* Replay Controls */}
        {routeCoords.length >= 3 && (
          <div className="flex items-center justify-center gap-3">
            <button onClick={resetReplay} className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
              <RotateCcw size={16} />
            </button>
            <button
              onClick={isPlaying ? pauseReplay : startReplay}
              className="p-3 rounded-full gradient-primary text-white shadow-md"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            {/* Progress */}
            <div className="flex-1 max-w-[150px]">
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all"
                  style={{ width: `${(replayIndex / Math.max(routeCoords.length - 1, 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 gap-3">
          <div className="glass-card p-3.5 text-center">
            <p className="text-lg font-bold text-gray-900 dark:text-white">{formatDistance(walk.distance_meters)}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Distance</p>
          </div>
          <div className="glass-card p-3.5 text-center">
            <div className="flex items-center justify-center gap-1">
              <Clock size={14} className="text-gray-400" />
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatDuration(walk.duration_seconds)}</p>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Duration</p>
          </div>
          <div className="glass-card p-3.5 text-center">
            <div className="flex items-center justify-center gap-1">
              <Leaf size={14} className="text-emerald-500" />
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{(walk.co2_saved_grams / 1000).toFixed(2)} kg</p>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">CO₂ Saved</p>
          </div>
          <div className="glass-card p-3.5 text-center">
            <div className="flex items-center justify-center gap-1">
              <Flame size={14} className="text-accent-500" />
              <p className="text-lg font-bold text-accent-500">+{formatNumber(walk.ecopoints_earned)}</p>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">EcoPoints</p>
          </div>
        </motion.div>

        {/* Additional Info */}
        {walk.avg_aqi != null && (
          <div className="glass-card p-3.5 flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">Average AQI</span>
            <span className={`text-sm font-bold ${walk.avg_aqi <= 50 ? 'text-green-500' : walk.avg_aqi <= 100 ? 'text-yellow-500' : 'text-red-500'}`}>
              {walk.avg_aqi}
            </span>
          </div>
        )}

        {/* AQ Calibration Feedback */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wind size={16} className="text-primary-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">How was the air quality?</h3>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-3">Your feedback helps calibrate VAYU Engine (+5 EcoPoints)</p>
          {aqSubmitted ? (
            <div className="flex items-center gap-2 text-primary-500 text-xs font-medium">
              <Star size={14} className="fill-primary-500" />
              Thanks! You rated: {aqRating}/5
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  onClick={() => handleAQCalibration(rating)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition hover:scale-105 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-primary-100 dark:hover:bg-primary-900/30 hover:text-primary-600"
                >
                  {rating === 1 ? '😷' : rating === 2 ? '😐' : rating === 3 ? '🙂' : rating === 4 ? '😊' : '🌿'} {rating}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <BottomNavigation />
    </div>
  );
}
