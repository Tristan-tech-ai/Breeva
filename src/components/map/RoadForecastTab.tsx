import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface ForecastPoint {
  hour_offset: number;
  pm25: number;
  sigma: number;
  pi95_lower: number;
  pi95_upper: number;
}

interface ForecastResponse {
  osm_way_id: number;
  forecast_anchor: string | null;
  model_version: string | null;
  forecast: ForecastPoint[];
}

interface Props {
  osmWayId: number;
}

export function RoadForecastTab({ osmWayId }: Props) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/vayu/road-forecast?osm_way_id=${osmWayId}&h=24`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ForecastResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [osmWayId]);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading forecast…</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-red-500">Forecast unavailable ({error})</div>;
  }
  if (!data || data.forecast.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No 24h forecast available for this road yet. The ST-GNN model precomputes hourly —
        check back after the next 02:30 WIB nightly job.
      </div>
    );
  }

  const chartData = data.forecast.map((p) => ({
    hour: `+${p.hour_offset}h`,
    pm25: Math.round(p.pm25 * 10) / 10,
    lower: Math.round(p.pi95_lower * 10) / 10,
    upper: Math.round(p.pi95_upper * 10) / 10,
  }));

  const maxPm = Math.max(...chartData.map((d) => d.upper));

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          24 h PM2.5 forecast
        </h3>
        {data.model_version && (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {data.model_version}
          </span>
        )}
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="confBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, Math.ceil(maxPm / 10) * 10]} />
            <Tooltip
              contentStyle={{ fontSize: 12, padding: 6 }}
              formatter={(value, name) => [`${value} µg/m³`, String(name)]}
            />
            <ReferenceLine y={35} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'WHO daily', position: 'right', fontSize: 9 }} />
            <Area type="monotone" dataKey="upper" stroke="none" fill="url(#confBand)" name="PI95 upper" />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#fff" name="PI95 lower" />
            <Area type="monotone" dataKey="pm25" stroke="#1d4ed8" fill="none" strokeWidth={2} name="μ" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        ST-GNN per-road forecast · 95% prediction interval shaded
      </p>
    </div>
  );
}
