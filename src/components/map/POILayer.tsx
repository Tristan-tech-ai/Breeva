import { useEffect, useState, useMemo, useCallback } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import type { Coordinate } from '../../types';
import type { POI } from '../../lib/poi-api';
import { getNearbyPOIs } from '../../lib/poi-api';

interface POILayerProps {
  center: Coordinate;
  radiusMeters?: number;
  categories?: string[];
  visible?: boolean;
  onPlaceSelect?: (poi: POI) => void;
}

// ── Professional SVG icons per category ──────────────────────────────

const SVG_ICONS: Record<string, { path: string; color: string }> = {
  restaurant: {
    color: '#f97316',
    path: 'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z',
  },
  cafe: {
    color: '#92400e',
    path: 'M2 21h18v-2H2M20 8h-2V5h2m0-2H4v10a4 4 0 004 4h6a4 4 0 004-4v-3h2a2 2 0 002-2V5a2 2 0 00-2-2z',
  },
  coffee: {
    color: '#92400e',
    path: 'M2 21h18v-2H2M20 8h-2V5h2m0-2H4v10a4 4 0 004 4h6a4 4 0 004-4v-3h2a2 2 0 002-2V5a2 2 0 00-2-2z',
  },
  bakery: {
    color: '#d97706',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.22.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  },
  bar: {
    color: '#7c3aed',
    path: 'M21 5V3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9zM7.43 7L5.66 5h12.69l-1.78 2H7.43z',
  },
  fast: {
    color: '#ef4444',
    path: 'M18.06 23h1.66c.84 0 1.53-.65 1.63-1.47L23 7h-7.76V1.75C15.24.79 14.46 0 13.5 0h-3C9.54 0 8.76.79 8.76 1.75V7H1l1.65 14.53c.1.82.79 1.47 1.63 1.47h1.66c.83 0 1.52-.65 1.63-1.47L8.84 7h2.16v14h2V7h2.16l1.27 14.53c.11.82.8 1.47 1.63 1.47z',
  },
  park: {
    color: '#16a34a',
    path: 'M17 12h2L12 2 5.05 12H7l-3.9 6h6.92v4h3.96v-4H21l-4-6z',
  },
  garden: {
    color: '#16a34a',
    path: 'M17 12h2L12 2 5.05 12H7l-3.9 6h6.92v4h3.96v-4H21l-4-6z',
  },
  shop: {
    color: '#eab308',
    path: 'M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 14H6V8h2v2c0 .55.45 1 1 1s1-.45 1-1V8h4v2c0 .55.45 1 1 1s1-.45 1-1V8h2v10z',
  },
  store: {
    color: '#eab308',
    path: 'M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z',
  },
  supermarket: {
    color: '#22c55e',
    path: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0020.25 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z',
  },
  market: {
    color: '#eab308',
    path: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0020.25 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z',
  },
  convenience: {
    color: '#22c55e',
    path: 'M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z',
  },
  pharmacy: {
    color: '#ef4444',
    path: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
  },
  hospital: {
    color: '#ef4444',
    path: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
  },
  clinic: {
    color: '#ef4444',
    path: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
  },
  hotel: {
    color: '#6366f1',
    path: 'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z',
  },
  mosque: {
    color: '#10b981',
    path: 'M12 2C8 2 4.5 5.5 4.5 9.5c0 2 1 3.8 2.5 5V22h11v-7.5c1.5-1.2 2.5-3 2.5-5C20.5 5.5 17 2 12 2zm0 2c3 0 5.5 2.5 5.5 5.5 0 1.5-.6 2.8-1.5 3.8V20h-8v-6.7c-.9-1-1.5-2.3-1.5-3.8C6.5 6.5 9 4 12 4z',
  },
  church: {
    color: '#8b5cf6',
    path: 'M18 12.22V9l-5-2.5V5h2V3h-2V1h-2v2H9v2h2v1.5L6 9v3.22L2 14v8h8v-3c0-1.1.9-2 2-2s2 .9 2 2v3h8v-8l-4-1.78z',
  },
  school: {
    color: '#3b82f6',
    path: 'M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z',
  },
  university: {
    color: '#3b82f6',
    path: 'M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z',
  },
  gym: {
    color: '#14b8a6',
    path: 'M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z',
  },
  bank: {
    color: '#6366f1',
    path: 'M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z',
  },
  atm: {
    color: '#6366f1',
    path: 'M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z',
  },
  gas: {
    color: '#f59e0b',
    path: 'M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5z',
  },
  fuel: {
    color: '#f59e0b',
    path: 'M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5z',
  },
  museum: {
    color: '#8b5cf6',
    path: 'M22 11V9L12 2 2 9v2h2v9H2v2h20v-2h-2v-9h2zm-6 9h-3v-6h-2v6H8v-9h8v9z',
  },
  cinema: {
    color: '#ec4899',
    path: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z',
  },
  library: {
    color: '#6366f1',
    path: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
  },
  salon: {
    color: '#ec4899',
    path: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  },
  spa: {
    color: '#14b8a6',
    path: 'M15.49 9.63c-.16-2.42-1.03-4.79-2.64-6.55-.34-.37-.72-.73-1.12-1.08l-.27.27C9.23 4.57 7.83 7.23 7 10.2c-1.1-.28-2.29-.34-3.5-.14 0 0-.43 5.3 4.66 7.18 1.06.39 2.2.56 3.34.52v2.74c-1.37 0-2.5 1.13-2.5 2.5h6c0-1.37-1.13-2.5-2.5-2.5v-2.74c1.14.04 2.29-.13 3.34-.52 5.09-1.88 4.66-7.18 4.66-7.18-1.21-.2-2.4-.14-3.51.14.03-.15.05-.3.07-.45-.4-.55-.93-1.06-1.56-1.5z',
  },
  parking: {
    color: '#6b7280',
    path: 'M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2z',
  },
  default: {
    color: '#6b7280',
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  },
};

function getSvgIcon(category: string): { path: string; color: string } {
  const lower = category.toLowerCase();
  for (const [key, icon] of Object.entries(SVG_ICONS)) {
    if (key !== 'default' && lower.includes(key)) return icon;
  }
  return SVG_ICONS.default;
}

// Cache icons
const iconCache = new Map<string, L.DivIcon>();

function getIcon(category: string): L.DivIcon {
  const cacheKey = category.toLowerCase();
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const { path, color } = getSvgIcon(category);
  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:32px;height:32px;
      background:${color};
      border:2.5px solid white;
      border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
    "><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="${path}"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
  iconCache.set(cacheKey, icon);
  return icon;
}

export default function POILayer({
  center,
  radiusMeters = 1500,
  categories,
  visible = true,
  onPlaceSelect,
}: POILayerProps) {
  const [pois, setPOIs] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);

  // Round center to ~200m grid to avoid re-fetching on tiny moves
  const gridLat = Math.round(center.lat * 500) / 500;
  const gridLng = Math.round(center.lng * 500) / 500;

  useEffect(() => {
    if (!visible) {
      setPOIs([]);
      return;
    }

    let cancelled = false;
    const fetchPOIs = async () => {
      setLoading(true);
      try {
        const { pois: results } = await getNearbyPOIs(
          { lat: gridLat, lng: gridLng },
          radiusMeters,
          categories,
        );
        if (!cancelled) setPOIs(results);
      } catch {
        // silently fail
      }
      if (!cancelled) setLoading(false);
    };

    fetchPOIs();
    return () => { cancelled = true; };
  }, [gridLat, gridLng, radiusMeters, visible]);

  const handleClick = useCallback(
    (poi: POI) => {
      if (onPlaceSelect) onPlaceSelect(poi);
    },
    [onPlaceSelect],
  );

  const markers = useMemo(() => {
    if (!visible || loading || pois.length === 0) return null;
    return pois.map((poi) => (
      <Marker
        key={poi.id}
        position={[poi.coordinate.lat, poi.coordinate.lng]}
        icon={getIcon(poi.category)}
        eventHandlers={{ click: () => handleClick(poi) }}
      />
    ));
  }, [pois, visible, loading, handleClick]);

  return <>{markers}</>;
}
