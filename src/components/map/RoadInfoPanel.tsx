/**
 * RoadInfoPanel — surfaced on road click to show AI explainability narrative.
 *
 * Calls /api/vayu/road-aqi?osm_way_id=... for the given osm_way_id and renders:
 * - 1-2 sentence summary (why this road's AQI is high/low)
 * - Pollution drivers nearby (bullet list)
 * - Mitigators (parks, alternatives)
 * - Alternative-route hint
 *
 * Populated by gemini-classify?mode=narrative cron (top-tier roads only).
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface NarrativeBody {
  summary?: string;
  pollution_drivers?: string[];
  mitigators?: string[];
  alternative_route_hint?: string;
}

interface NarrativeResponse {
  osm_way_id: number;
  name: string | null;
  highway: string;
  region: string;
  narrative: NarrativeBody | null;
  grounded_at: string | null;
  sources: Array<{ name?: string; type?: string }>;
}

export function RoadInfoPanel({ osmWayId, className = '' }: { osmWayId: number; className?: string }) {
  const [data, setData] = useState<NarrativeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/vayu/road-aqi?osm_way_id=${osmWayId}`)
      .then(async r => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: NarrativeResponse | null) => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [osmWayId]);

  if (loading) {
    return (
      <div className={`rounded-xl bg-white/95 p-3 shadow ${className}`}>
        <div className="text-xs text-gray-400 animate-pulse">Memuat analisis AI...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl bg-white/95 p-3 shadow ${className}`}>
        <div className="text-xs text-red-600">{error}</div>
      </div>
    );
  }

  if (!data || !data.narrative?.summary) {
    return (
      <div className={`rounded-xl bg-white/95 p-3 shadow ${className}`}>
        <div className="text-xs text-gray-500">
          Belum ada analisis AI untuk jalan ini.
          <br />
          <span className="text-[10px] text-gray-400">
            Top-tier roads (motorway/trunk/primary) di-narate via Gemini secara batch harian.
          </span>
        </div>
      </div>
    );
  }

  const n = data.narrative;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl bg-white/95 p-4 shadow-lg space-y-3 ${className}`}
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded font-medium uppercase">
            AI analysis
          </span>
          <span className="text-xs text-gray-500">{data.name ?? data.highway}</span>
        </div>
        <p className="text-sm text-gray-800 leading-relaxed">{n.summary}</p>
      </div>

      {n.pollution_drivers && n.pollution_drivers.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-red-700 mb-1">Sumber polusi terdekat</div>
          <ul className="text-xs text-gray-700 space-y-0.5 list-disc list-inside">
            {n.pollution_drivers.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      {n.mitigators && n.mitigators.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-emerald-700 mb-1">Mitigator / pelindung</div>
          <ul className="text-xs text-gray-700 space-y-0.5 list-disc list-inside">
            {n.mitigators.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {n.alternative_route_hint && (
        <div className="p-2 bg-emerald-50 rounded-lg flex gap-2">
          <span className="text-emerald-600 shrink-0">💡</span>
          <p className="text-xs text-emerald-900">{n.alternative_route_hint}</p>
        </div>
      )}

      {data.sources?.length > 0 && (
        <div className="text-[10px] text-gray-400 border-t pt-2">
          Sumber: {data.sources.map(s => s.name).filter(Boolean).join(', ')}
        </div>
      )}

      {data.grounded_at && (
        <div className="text-[10px] text-gray-400">
          Dianalisis: {new Date(data.grounded_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
      )}
    </motion.div>
  );
}

export default RoadInfoPanel;
