/**
 * RouteForecast — 24h AQI prediction visualization for a point/cell.
 *
 * Uses /api/vayu/aqi-forecast (LSTM-generated, refreshed hourly on PC).
 * Renders bar chart of next 24h AQI + highlights best hour to walk.
 *
 * Used in route detail sheets and walk preview flows.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface ForecastPrediction {
  hour: number;
  pm25: number;
  aqi: number;
}

interface ForecastResponse {
  cell_id: string;
  forecast_made_at?: string;
  predictions: ForecastPrediction[];
  best_hour?: { hour: number; aqi: number } | null;
  fallback?: string;
}

interface RouteForecastProps {
  lat?: number;
  lng?: number;
  cellId?: string;
  className?: string;
}

function aqiColor(aqi: number): string {
  if (aqi < 50) return '#22c55e';   // good (green)
  if (aqi < 100) return '#facc15';  // moderate (yellow)
  if (aqi < 150) return '#fb923c';  // sensitive (orange)
  if (aqi < 200) return '#ef4444';  // unhealthy (red)
  if (aqi < 300) return '#a855f7';  // very unhealthy (purple)
  return '#7f1d1d';                 // hazardous
}

function aqiLabel(aqi: number): string {
  if (aqi < 50) return 'Baik';
  if (aqi < 100) return 'Sedang';
  if (aqi < 150) return 'Tidak Sehat (sensitif)';
  if (aqi < 200) return 'Tidak Sehat';
  if (aqi < 300) return 'Sangat Tidak Sehat';
  return 'Berbahaya';
}

export function RouteForecast({ lat, lng, cellId, className = '' }: RouteForecastProps) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (cellId) params.set('cell_id', cellId);
    else if (lat != null && lng != null) {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
    } else {
      setError('No location provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    fetch(`/api/vayu/aqi-forecast?${params.toString()}`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((d: ForecastResponse) => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cellId, lat, lng]);

  if (loading) {
    return (
      <div className={`rounded-xl bg-white/80 p-3 shadow ${className}`}>
        <div className="text-xs text-gray-400 animate-pulse">Memuat prediksi 24 jam...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl bg-white/80 p-3 shadow ${className}`}>
        <div className="text-xs text-red-600">Forecast unavailable: {error}</div>
      </div>
    );
  }

  if (!data || data.predictions.length === 0) {
    return (
      <div className={`rounded-xl bg-white/80 p-3 shadow ${className}`}>
        <div className="text-xs text-gray-500">
          Belum ada prediksi 24 jam untuk lokasi ini.
          <br />
          <span className="text-[10px] text-gray-400">
            LSTM model perlu min. 24h aqi_grid history per cell.
          </span>
        </div>
      </div>
    );
  }

  const currentHour = new Date().getHours();
  const maxAqi = Math.max(...data.predictions.map(p => p.aqi), 50);

  return (
    <div className={`rounded-xl bg-white/95 p-3 shadow ${className}`}>
      <h4 className="text-sm font-semibold text-gray-800">Prediksi AQI 24 Jam</h4>

      {/* Bar chart */}
      <div className="flex items-end gap-0.5 h-16 mt-3" role="img" aria-label="24-hour AQI forecast">
        {data.predictions.map(p => {
          const clockHour = (currentHour + p.hour) % 24;
          const heightPct = Math.max(8, (p.aqi / maxAqi) * 100);
          const isBest = data.best_hour && p.hour === data.best_hour.hour;
          return (
            <div
              key={p.hour}
              className="flex-1 rounded-sm relative group cursor-pointer"
              style={{
                backgroundColor: aqiColor(p.aqi),
                height: `${heightPct}%`,
                border: isBest ? '2px solid #10b981' : undefined,
              }}
              title={`${String(clockHour).padStart(2, '0')}:00 → AQI ${p.aqi} (${aqiLabel(p.aqi)})`}
            >
              {isBest && (
                <span
                  className="absolute -top-3 left-1/2 transform -translate-x-1/2 text-[8px] text-emerald-600 font-bold"
                  aria-hidden
                >★</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Hour labels every 6h */}
      <div className="flex justify-between mt-1 text-[9px] text-gray-500 px-0.5">
        <span>{String(currentHour).padStart(2, '0')}:00</span>
        <span>+6</span>
        <span>+12</span>
        <span>+18</span>
        <span>+24h</span>
      </div>

      {data.best_hour && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 px-3 py-2 bg-emerald-50 rounded-lg flex items-center gap-2"
        >
          <span className="text-emerald-600">★</span>
          <div className="text-xs">
            <span className="font-medium text-emerald-900">
              Waktu terbaik: {String((currentHour + data.best_hour.hour) % 24).padStart(2, '0')}:00
            </span>
            <span className="text-emerald-700 ml-1">
              · AQI {data.best_hour.aqi} ({aqiLabel(data.best_hour.aqi)})
            </span>
          </div>
        </motion.div>
      )}

      {data.forecast_made_at && (
        <div className="text-[9px] text-gray-400 mt-2">
          Updated {new Date(data.forecast_made_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
        </div>
      )}
    </div>
  );
}

export default RouteForecast;
