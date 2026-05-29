import { useEffect, useState } from 'react';
import { Route as RouteIcon, Footprints, Loader2 } from 'lucide-react';
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
  duration_seconds: number | null;
  distance_meters: number | null;
  completed_at: string | null;
}

const ROUTE_LABELS: Record<string, string> = {
  cleanest: 'Rute paling bersih', eco: 'Rute paling bersih',
  balanced: 'Rute seimbang', fastest: 'Rute tercepat', fast: 'Rute tercepat',
};

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

export default function RouteSelector({
  selectedKey, onSelect,
}: {
  selectedKey: string | null;
  onSelect: (d: SelectedRouteData | null) => void;
}) {
  const routes = useMapStore((s) => s.routes);
  const { user } = useAuthStore();
  const [walks, setWalks] = useState<WalkRow[]>([]);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('walks')
      .select('id, route_polyline, duration_seconds, distance_meters, completed_at')
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
    const polyline = parsePolyline(w.route_polyline);
    if (polyline.length < 2) { setError('Jalan ini tidak punya jejak rute yang valid.'); return; }
    setError(null);
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

  return (
    <div className="glass-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pilih rute</h3>

      {/* Planned routes (from the map) — have v2 segments already, no fetch */}
      {planned.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Rute terencana</p>
          {planned.map((r, i) => {
            const key = `planned-${i}`;
            return (
              <button
                key={key}
                type="button"
                onClick={() => pickPlanned(i)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition ${
                  selectedKey === key
                    ? 'border-primary-400 bg-primary-50/60 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <RouteIcon className="w-4 h-4 text-primary-500 shrink-0" />
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">
                  {ROUTE_LABELS[r.route_label ?? r.route_type ?? ''] ?? 'Rute terencana'}
                </span>
                <span className="text-[11px] text-gray-400">
                  {(r.distance_meters / 1000).toFixed(1)} km · AQI {Math.round(r.vayu_avg_aqi ?? r.avg_aqi)}
                </span>
              </button>
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
              <button
                key={key}
                type="button"
                disabled={loadingKey === key}
                onClick={() => pickWalk(w)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition disabled:opacity-60 ${
                  selectedKey === key
                    ? 'border-primary-400 bg-primary-50/60 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                {loadingKey === key
                  ? <Loader2 className="w-4 h-4 text-primary-500 shrink-0 animate-spin" />
                  : <Footprints className="w-4 h-4 text-primary-500 shrink-0" />}
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">
                  {w.completed_at ? new Date(w.completed_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Jalan tersimpan'}
                </span>
                <span className="text-[11px] text-gray-400">
                  {((w.distance_meters ?? 0) / 1000).toFixed(1)} km
                </span>
              </button>
            );
          })}
        </div>
      )}

      {planned.length === 0 && walks.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          Belum ada rute. Rencanakan rute bersih di peta, atau selesaikan satu jalan kaki, lalu kembali ke sini untuk menghitung paparan.
        </p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
