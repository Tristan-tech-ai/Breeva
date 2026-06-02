import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Route as RouteIcon, Footprints, Loader2, Check, MapPin, ArrowRight, Map as MapIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { getRouteScoreSegments } from '../../lib/api';
import type { RouteSegmentAQI } from '../../types';

export interface SelectedRouteData {
  key: string;
  label: string;
  segments: RouteSegmentAQI[];
  durationSeconds: number;
  distanceMeters?: number;
}

interface WalkRow {
  id: string;
  route_polyline: string | null;
  route_segments: RouteSegmentAQI[] | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  completed_at: string | null;
}

const ROUTE_LABELS: Record<string, string> = {
  cleanest: 'Rute paling bersih', eco: 'Rute paling bersih',
  balanced: 'Rute seimbang', fastest: 'Rute tercepat', fast: 'Rute tercepat',
};

function aqiColor(aqi: number): string {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#eab308';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#7f1d1d';
}

function parsePolyline(raw: string | null): [number, number][] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p): [number, number] | null => {
        if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])];
        if (p && typeof p === 'object' && 'lat' in p && 'lng' in p) return [Number(p.lat), Number(p.lng)];
        return null;
      })
      .filter((p): p is [number, number] => p !== null && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  } catch {
    return [];
  }
}

function RouteRow({
  icon: Icon, color, title, meta, selected, loading, disabled, reduce, onClick,
}: {
  icon: LucideIcon; color: string; title: string; meta: string;
  selected: boolean; loading?: boolean; disabled?: boolean; reduce: boolean; onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition disabled:opacity-60 ${
        selected
          ? 'border-primary-400 bg-primary-50/70 dark:bg-primary-900/20 ring-1 ring-primary-400/40'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <span className="grid place-items-center w-9 h-9 rounded-lg shrink-0" style={{ background: `${color}1f` }}>
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" style={{ color }} />
          : <Icon className="w-4 h-4" style={{ color }} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{title}</span>
        <span className="block text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{meta}</span>
      </span>
      {selected && <Check className="w-4 h-4 text-primary-500 shrink-0" />}
    </motion.button>
  );
}

export default function RouteSelector({
  selectedKey, onSelect,
}: {
  selectedKey: string | null;
  onSelect: (d: SelectedRouteData | null) => void;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const routes = useMapStore((s) => s.routes);
  const { user } = useAuthStore();
  const [walks, setWalks] = useState<WalkRow[]>([]);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('walks')
      .select('id, route_polyline, route_segments, duration_seconds, distance_meters, completed_at')
      .eq('user_id', user.id)
      .not('route_polyline', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setWalks((data as WalkRow[]) ?? []));
  }, [user]);

  const planned = routes.filter((r) => r.vayu_score?.segments && r.vayu_score.segments.length > 0);

  const pickPlanned = (idx: number) => {
    const r = planned[idx];
    const key = `planned-${idx}`;
    setError(null);
    onSelect({
      key,
      label: ROUTE_LABELS[r.route_label ?? r.route_type ?? ''] ?? 'Rute terencana',
      segments: r.vayu_score!.segments,
      durationSeconds: r.duration_seconds,
      distanceMeters: r.distance_meters,
    });
  };

  const pickWalk = async (w: WalkRow) => {
    const key = `walk-${w.id}`;
    setError(null);

    // Fast path: segments captured at completion → dose instantly, no route-score call.
    if (w.route_segments && w.route_segments.length > 0) {
      onSelect({
        key,
        label: `Jalan ${w.completed_at ? new Date(w.completed_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : ''}`.trim(),
        segments: w.route_segments,
        durationSeconds: w.duration_seconds ?? 0,
        distanceMeters: w.distance_meters ?? undefined,
      });
      return;
    }

    const polyline = parsePolyline(w.route_polyline);
    if (polyline.length < 2) { setError('Jalan ini tidak punya jejak rute yang valid.'); return; }
    setLoadingKey(key);
    try {
      const score = await getRouteScoreSegments(polyline, w.duration_seconds ?? undefined);
      if (!score?.segments?.length) { setError('Gagal menilai rute jalan ini. Coba lagi.'); onSelect(null); return; }
      onSelect({
        key,
        label: `Jalan ${w.completed_at ? new Date(w.completed_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : ''}`.trim(),
        segments: score.segments,
        durationSeconds: w.duration_seconds ?? 0,
        distanceMeters: w.distance_meters ?? undefined,
      });
    } finally {
      setLoadingKey(null);
    }
  };

  const isEmpty = planned.length === 0 && walks.length === 0;

  return (
    <div className="glass-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <RouteIcon className="w-4 h-4 text-primary-500" /> Pilih rute
      </h3>

      {/* Planned routes (from the map) — have v2 segments already, no fetch */}
      {planned.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Rute terencana</p>
          {planned.map((r, i) => {
            const key = `planned-${i}`;
            const aqi = Math.round(r.vayu_avg_aqi ?? r.avg_aqi);
            return (
              <RouteRow
                key={key}
                icon={RouteIcon}
                color={aqiColor(aqi)}
                title={ROUTE_LABELS[r.route_label ?? r.route_type ?? ''] ?? 'Rute terencana'}
                meta={`${(r.distance_meters / 1000).toFixed(1)} km · AQI ${aqi}`}
                selected={selectedKey === key}
                reduce={reduce}
                onClick={() => pickPlanned(i)}
              />
            );
          })}
        </div>
      )}

      {/* Saved walks — score the polyline on demand */}
      {walks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Riwayat jalan</p>
          {walks.map((w) => {
            const key = `walk-${w.id}`;
            return (
              <RouteRow
                key={key}
                icon={Footprints}
                color="#10b981"
                title={w.completed_at ? new Date(w.completed_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Jalan tersimpan'}
                meta={`${((w.distance_meters ?? 0) / 1000).toFixed(1)} km`}
                selected={selectedKey === key}
                loading={loadingKey === key}
                disabled={loadingKey === key}
                reduce={reduce}
                onClick={() => pickWalk(w)}
              />
            );
          })}
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center text-center py-6 px-2">
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-primary-500/10 mb-3">
            <MapIcon className="w-6 h-6 text-primary-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed max-w-xs">
            Belum ada rute. Rencanakan rute bersih di peta atau selesaikan satu jalan kaki, lalu kembali ke sini untuk menghitung paparan.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition"
          >
            <MapPin className="w-3.5 h-3.5" /> Buka peta <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
