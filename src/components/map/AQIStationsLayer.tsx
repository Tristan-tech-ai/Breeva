import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';

// ── Types ────────────────────────────────────────────────────────────

interface StationMarker {
  uid: number;
  lat: number;
  lon: number;
  aqi: string; // can be "-" for no data
  name: string;
}

interface StationDetail {
  aqi: number;
  name: string;
  time: string;
  iaqi: Record<string, number>;
  attributions: string[];
  dominentpol?: string;
}

// ── AQI color logic ──────────────────────────────────────────────────

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
  if (aqi <= 150) return 'Unhealthy for Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

function aqiTextColor(aqi: number): string {
  if (aqi <= 50) return '#fff';
  if (aqi <= 100) return '#422006';
  return '#fff';
}

// ── Marker icon factory ──────────────────────────────────────────────

function createStationIcon(aqi: number): L.DivIcon {
  const bg = aqiColor(aqi);
  const fg = aqiTextColor(aqi);
  const size = aqi >= 100 ? 32 : 28;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:6px;
      background:${bg};color:${fg};
      font-size:11px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
      border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 1px 4px rgba(0,0,0,0.3);
      cursor:pointer;user-select:none;
      line-height:1;
    ">${aqi}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ── Popup HTML builder ───────────────────────────────────────────────

function buildPopupHtml(s: StationDetail): string {
  const bg = aqiColor(s.aqi);
  const fg = aqiTextColor(s.aqi);
  const label = aqiLabel(s.aqi);

  const pollutantRows = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co']
    .filter(k => s.iaqi[k] !== undefined)
    .map(k => {
      const name = k === 'pm25' ? 'PM₂.₅' : k === 'pm10' ? 'PM₁₀' : k === 'o3' ? 'O₃' : k === 'no2' ? 'NO₂' : k === 'so2' ? 'SO₂' : 'CO';
      const val = s.iaqi[k];
      const c = aqiColor(val);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0;">
        <span style="font-size:11px;color:#666;">${name}</span>
        <span style="font-size:12px;font-weight:600;color:${c};">${val}</span>
      </div>`;
    }).join('');

  const timeStr = s.time ? new Date(s.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const attrStr = s.attributions.length > 0 ? `<div style="font-size:9px;color:#999;margin-top:6px;line-height:1.3;">Source: ${escapeHtml(s.attributions[0])}</div>` : '';

  return `<div style="min-width:180px;max-width:220px;font-family:system-ui,sans-serif;">
    <div style="font-size:12px;font-weight:700;color:#333;margin-bottom:6px;line-height:1.3;">${escapeHtml(s.name)}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <div style="width:40px;height:40px;border-radius:8px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;">${s.aqi}</div>
      <div>
        <div style="font-size:12px;font-weight:600;color:${bg};">${label}</div>
        ${s.dominentpol ? `<div style="font-size:10px;color:#999;">Main: ${s.dominentpol.toUpperCase()}</div>` : ''}
      </div>
    </div>
    ${pollutantRows ? `<div style="margin-bottom:4px;">${pollutantRows}</div>` : ''}
    ${timeStr ? `<div style="font-size:10px;color:#aaa;margin-top:4px;">Updated ${timeStr}</div>` : ''}
    ${attrStr}
  </div>`;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Detail fetch cache ───────────────────────────────────────────────

const detailCache = new Map<number, { data: StationDetail; ts: number }>();
const DETAIL_TTL = 30 * 60 * 1000; // 30 min

async function fetchStationDetail(uid: number): Promise<StationDetail | null> {
  const cached = detailCache.get(uid);
  if (cached && Date.now() - cached.ts < DETAIL_TTL) return cached.data;

  const token = import.meta.env.VITE_WAQI_TOKEN || 'demo';
  try {
    const resp = await fetch(`https://api.waqi.info/feed/@${uid}/?token=${token}`);
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json.status !== 'ok' || !json.data) return null;

    const d = json.data;
    const iaqi: Record<string, number> = {};
    if (d.iaqi) {
      for (const [k, v] of Object.entries(d.iaqi)) {
        iaqi[k] = (v as { v: number }).v;
      }
    }

    const detail: StationDetail = {
      aqi: typeof d.aqi === 'number' ? d.aqi : parseInt(d.aqi, 10) || 0,
      name: d.city?.name || '',
      time: d.time?.iso || d.time?.s || '',
      iaqi,
      attributions: (d.attributions || []).map((a: { name: string }) => a.name),
      dominentpol: d.dominentpol,
    };
    detailCache.set(uid, { data: detail, ts: Date.now() });
    return detail;
  } catch {
    return null;
  }
}

// ── Bounds fetch + debounce ──────────────────────────────────────────

const boundsCache = new Map<string, { stations: StationMarker[]; ts: number }>();
const BOUNDS_TTL = 10 * 60 * 1000; // 10 min

function quantizeBounds(b: L.LatLngBounds): string {
  const q = (v: number, step: number) => Math.round(v / step) * step;
  // Quantize to ~0.5° grid to maximize cache hits
  return `${q(b.getSouth(), 0.5)},${q(b.getWest(), 0.5)},${q(b.getNorth(), 0.5)},${q(b.getEast(), 0.5)}`;
}

async function fetchStations(bounds: L.LatLngBounds): Promise<StationMarker[]> {
  const key = quantizeBounds(bounds);
  const cached = boundsCache.get(key);
  if (cached && Date.now() - cached.ts < BOUNDS_TTL) return cached.stations;

  const token = import.meta.env.VITE_WAQI_TOKEN || 'demo';
  const latlng = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  try {
    const resp = await fetch(`https://api.waqi.info/v2/map/bounds?latlng=${latlng}&networks=all&token=${token}`);
    if (!resp.ok) return [];
    const json = await resp.json();
    if (json.status !== 'ok' || !Array.isArray(json.data)) return [];

    const stations: StationMarker[] = json.data
      .filter((s: { aqi: string }) => s.aqi !== '-' && s.aqi !== '')
      .map((s: { uid: number; lat: number; lon: number; aqi: string; station: { name: string } }) => ({
        uid: s.uid,
        lat: s.lat,
        lon: s.lon,
        aqi: s.aqi,
        name: s.station?.name || '',
      }));
    boundsCache.set(key, { stations, ts: Date.now() });
    return stations;
  } catch {
    return [];
  }
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useAQIStationsLayer(map: L.Map | null, visible: boolean): void {
  const layerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const updateStations = useCallback(async () => {
    if (!map || !visible || !isMountedRef.current) return;

    const bounds = map.getBounds().pad(0.1); // 10% padding
    const stations = await fetchStations(bounds);
    if (!isMountedRef.current) return;

    const existingUids = new Set(markersRef.current.keys());
    const newUids = new Set(stations.map(s => s.uid));

    // Remove markers no longer in view
    for (const uid of existingUids) {
      if (!newUids.has(uid)) {
        markersRef.current.get(uid)?.remove();
        markersRef.current.delete(uid);
      }
    }

    // Add/update markers
    for (const s of stations) {
      const aqiNum = parseInt(s.aqi, 10);
      if (isNaN(aqiNum)) continue;

      if (markersRef.current.has(s.uid)) {
        // Update position if needed (rarely changes)
        continue;
      }

      const marker = L.marker([s.lat, s.lon], {
        icon: createStationIcon(aqiNum),
        zIndexOffset: 500,
        bubblingMouseEvents: false,
      });

      marker.on('click', async () => {
        marker.bindPopup('<div style="padding:8px;text-align:center;color:#aaa;font-size:12px;">Loading...</div>', {
          maxWidth: 250,
          className: 'aqi-station-popup',
        }).openPopup();

        const detail = await fetchStationDetail(s.uid);
        if (detail) {
          marker.setPopupContent(buildPopupHtml(detail));
        } else {
          marker.setPopupContent(`<div style="padding:8px;font-family:system-ui;">
            <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(s.name)}</div>
            <div style="font-size:24px;font-weight:800;color:${aqiColor(aqiNum)};">${aqiNum}</div>
            <div style="font-size:11px;color:${aqiColor(aqiNum)};">${aqiLabel(aqiNum)}</div>
          </div>`);
        }
      });

      marker.addTo(layerGroupRef.current);
      markersRef.current.set(s.uid, marker);
    }
  }, [map, visible]);

  // Debounced map move handler
  const onMapMove = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(updateStations, 400);
  }, [updateStations]);

  // Add/remove layer group based on visibility
  useEffect(() => {
    if (!map) return;
    if (visible) {
      if (!map.hasLayer(layerGroupRef.current)) {
        layerGroupRef.current.addTo(map);
      }
      updateStations();
      map.on('moveend', onMapMove);
      map.on('zoomend', onMapMove);
    } else {
      layerGroupRef.current.remove();
      // Clear all markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current.clear();
    }

    return () => {
      map.off('moveend', onMapMove);
      map.off('zoomend', onMapMove);
    };
  }, [map, visible, updateStations, onMapMove]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      layerGroupRef.current.remove();
      markersRef.current.forEach(m => m.remove());
      markersRef.current.clear();
    };
  }, []);
}
