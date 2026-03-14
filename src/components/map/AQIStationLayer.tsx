import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';

// ── Types ────────────────────────────────────────────────────────────

interface WAQIStation {
  lat: number;
  lon: number;
  uid: number;
  aqi: string;
  station: { name: string; time: string };
}

interface WAQIFeedData {
  aqi: number;
  idx: number;
  dominentpol: string;
  attributions: Array<{ url: string; name: string }>;
  city: { geo: number[]; name: string; url: string };
  iaqi: Record<string, { v: number }>;
  time: { s: string; tz: string; iso: string };
}

// ── Constants ────────────────────────────────────────────────────────

const WAQI_BASE = 'https://api.waqi.info';
const DEBOUNCE_MS = 300;
const BOUNDS_TTL = 5 * 60_000;
const FEED_TTL = 10 * 60_000;

// ── Caches ───────────────────────────────────────────────────────────

const boundsCache = new Map<string, { data: WAQIStation[]; ts: number }>();
const feedCache = new Map<number, { data: WAQIFeedData; ts: number }>();

// ── AQI helpers ──────────────────────────────────────────────────────

function aqiColor(aqi: number): string {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#eab308';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#7f1d1d';
}

function aqiLabel(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

// ── Fetch helpers ────────────────────────────────────────────────────

async function fetchBounds(bounds: L.LatLngBounds, token: string): Promise<WAQIStation[]> {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const key = `${sw.lat.toFixed(2)},${sw.lng.toFixed(2)},${ne.lat.toFixed(2)},${ne.lng.toFixed(2)}`;

  const cached = boundsCache.get(key);
  if (cached && Date.now() - cached.ts < BOUNDS_TTL) return cached.data;

  const resp = await fetch(
    `${WAQI_BASE}/v2/map/bounds?latlng=${sw.lat},${sw.lng},${ne.lat},${ne.lng}&networks=all&token=${encodeURIComponent(token)}`,
  );
  const json = await resp.json();
  if (json.status !== 'ok') return cached?.data ?? [];

  boundsCache.set(key, { data: json.data, ts: Date.now() });
  return json.data;
}

async function fetchFeed(uid: number, token: string): Promise<WAQIFeedData | null> {
  const cached = feedCache.get(uid);
  if (cached && Date.now() - cached.ts < FEED_TTL) return cached.data;

  const resp = await fetch(`${WAQI_BASE}/feed/@${uid}/?token=${encodeURIComponent(token)}`);
  const json = await resp.json();
  if (json.status !== 'ok') return null;

  feedCache.set(uid, { data: json.data, ts: Date.now() });
  return json.data;
}

// ── Popup builders ───────────────────────────────────────────────────

const PLABEL: Record<string, string> = {
  pm25: 'PM2.5', pm10: 'PM10', o3: 'O₃', no2: 'NO₂', so2: 'SO₂', co: 'CO',
};

function esc(s: string) { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function popupHtml(d: WAQIFeedData): string {
  const color = aqiColor(d.aqi);
  const label = aqiLabel(d.aqi);
  const name = esc(d.city.name);

  const pills = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co']
    .filter((p) => d.iaqi[p])
    .map((p) => {
      const v = d.iaqi[p].v;
      return `<span style="display:inline-flex;align-items:center;gap:2px;margin:2px 4px">
        <span style="width:8px;height:8px;border-radius:50%;background:${aqiColor(v)};display:inline-block"></span>
        <span style="font-size:11px;color:#64748b">${PLABEL[p]}</span>
        <span style="font-size:12px;font-weight:600">${v}</span>
      </span>`;
    })
    .join('');

  const wx: string[] = [];
  if (d.iaqi.t) wx.push(`🌡 ${d.iaqi.t.v}°C`);
  if (d.iaqi.h) wx.push(`💧 ${d.iaqi.h.v}%`);
  if (d.iaqi.w) wx.push(`🌬 ${d.iaqi.w.v} m/s`);

  const src =
    d.attributions
      .filter((a) => a.name !== 'World Air Quality Index Project')
      .map((a) => esc(a.name))
      .join(', ') || 'WAQI';

  const ago = timeAgo(d.time.iso);

  return `<div style="min-width:220px;max-width:280px;font-family:system-ui,-apple-system,sans-serif">
    <div style="font-weight:700;font-size:13px;line-height:1.3">${name}</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">🕒 Updated ${ago} · ${src}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="width:42px;height:42px;border-radius:10px;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px">${d.aqi}</div>
      <div>
        <div style="font-size:12px;font-weight:600;color:${color}">${label}</div>
        <div style="font-size:10px;color:#94a3b8">Dominant: ${esc(PLABEL[d.dominentpol] ?? d.dominentpol)}</div>
      </div>
    </div>
    ${pills ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:6px">${pills}</div>` : ''}
    ${wx.length ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px">${wx.join('  ')}</div>` : ''}
  </div>`;
}

function loadingHtml(name: string): string {
  return `<div style="min-width:180px;font-family:system-ui;text-align:center;padding:8px">
    <div style="font-weight:600;font-size:13px;margin-bottom:8px">${esc(name)}</div>
    <div style="font-size:12px;color:#94a3b8">Loading…</div>
  </div>`;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useAQIStationLayer(map: L.Map, visible: boolean): void {
  const groupRef = useRef(L.layerGroup());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(import.meta.env.VITE_WAQI_TOKEN || 'demo');

  const update = useCallback(async () => {
    const stations = await fetchBounds(map.getBounds(), tokenRef.current);
    groupRef.current.clearLayers();

    for (const s of stations) {
      const val = parseInt(s.aqi, 10);
      if (isNaN(val) || val < 0) continue;

      const color = aqiColor(val);

      const icon = L.divIcon({
        className: 'aqi-badge-wrapper',
        html: `<div class="aqi-badge" style="background:${color}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a7.5 7.5 0 1 0-10.6 10.6L12 23l4.9-4.7a7.5 7.5 0 0 0 .8-10.6z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>${val}</span>
        </div>`,
        iconSize: [44, 24],
        iconAnchor: [22, 12],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([s.lat, s.lon], {
        icon,
        bubblingMouseEvents: false,
        zIndexOffset: val, // higher AQI on top
      });

      marker.on('click', async () => {
        marker
          .bindPopup(loadingHtml(s.station.name), { maxWidth: 300, className: 'aqi-station-popup' })
          .openPopup();

        const feed = await fetchFeed(s.uid, tokenRef.current);
        marker.setPopupContent(
          feed
            ? popupHtml(feed)
            : '<div style="font-family:system-ui;padding:8px;color:#ef4444">Failed to load data</div>',
        );
      });

      groupRef.current.addLayer(marker);
    }
  }, [map]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(update, DEBOUNCE_MS);
  }, [update]);

  useEffect(() => {
    if (visible) {
      groupRef.current.addTo(map);
      update();
      map.on('moveend', schedule);
    } else {
      groupRef.current.clearLayers();
      groupRef.current.remove();
      map.off('moveend', schedule);
    }

    return () => {
      map.off('moveend', schedule);
      groupRef.current.clearLayers();
      groupRef.current.remove();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, map, update, schedule]);
}
