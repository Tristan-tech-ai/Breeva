import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { POI } from '../../lib/poi-api';
import { getNearbyPOIs } from '../../lib/poi-api';
import type { Coordinate } from '../../types';

interface POILayerProps {
  visible?: boolean;
  activeFilter?: string | null;
  onPlaceSelect?: (poi: POI) => void;
}

// ── Category filter → Geoapify categories & matching ─────────────────

export const FILTER_CATEGORIES: Record<string, string> = {
  restaurant: 'catering.restaurant,catering.fast_food',
  cafe: 'catering.cafe,catering.coffee_shop',
  hotel: 'accommodation.hotel,accommodation.guest_house,accommodation.hostel',
  park: 'leisure.park,leisure.playground,national_park',
  shop: 'commercial',
  mosque: 'religion.place_of_worship.islam',
  atm: 'service.financial.atm,service.financial.bank',
  gas: 'service.vehicle.fuel',
};

const FILTER_SYNONYMS: Record<string, string[]> = {
  restaurant: ['restaurant', 'fast_food', 'food_court', 'seafood', 'steak', 'pizza', 'sushi', 'noodle', 'bbq', 'dining', 'bistro'],
  cafe: ['cafe', 'coffee', 'coffee_shop', 'tea', 'bakery', 'dessert', 'ice_cream'],
  hotel: ['hotel', 'guest_house', 'hostel', 'motel', 'resort', 'villa', 'lodging', 'accommodation'],
  park: ['park', 'garden', 'recreation', 'playground', 'nature', 'national_park'],
  shop: ['shop', 'store', 'mall', 'market', 'supermarket', 'convenience', 'shopping', 'retail', 'commercial', 'clothes', 'electronics'],
  mosque: ['mosque', 'islam', 'place_of_worship'],
  atm: ['atm', 'bank', 'financial'],
  gas: ['fuel', 'gas_station', 'charging_station'],
};

export function matchesFilter(poi: POI, filter: string): boolean {
  const synonyms = FILTER_SYNONYMS[filter] || [filter];
  const targets = [poi.category, ...(poi.types || [])].map(s => s.toLowerCase());
  return synonyms.some(syn => targets.some(t => t.includes(syn)));
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

// ── Zoom-adaptive icon factory ───────────────────────────────────────

const iconCache = new Map<string, L.DivIcon>();

function getIcon(category: string, zoom: number, dimmed = false, types?: string[]): L.DivIcon {
  const baseSize = zoom >= 17 ? 38 : zoom >= 15 ? 32 : zoom >= 13 ? 26 : 20;
  const size = dimmed ? Math.max(baseSize - 6, 16) : baseSize;
  const opacity = dimmed ? 0.4 : 1;

  // Find best matching icon from category + types
  let matched = getSvgIcon(category);
  if (matched === SVG_ICONS.default && types) {
    for (const t of types) {
      const found = getSvgIcon(t);
      if (found !== SVG_ICONS.default) { matched = found; break; }
    }
  }

  const cacheKey = `${matched.color}_${size}_${dimmed ? 1 : 0}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const { path, color } = matched;
  const svgSize = Math.round(size * 0.48);

  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:2px solid white;
      border-radius:50%;
      box-shadow:0 1px 5px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
      transition:transform 0.12s ease, opacity 0.2s ease;
      opacity:${opacity};
    " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
      <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="white"><path d="${path}"/></svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  iconCache.set(cacheKey, icon);
  return icon;
}

// ── Importance score for priority rendering ──────────────────────────

function getImportance(poi: POI): number {
  const ratingScore = (poi.rating || 0) * 2;
  const reviewScore = Math.log10(1 + (poi.reviewCount || 0));
  return ratingScore + reviewScore;
}

function truncName(name: string, maxLen = 18): string {
  return name.length <= maxLen ? name : name.substring(0, maxLen - 1) + '\u2026';
}

// ── Component ────────────────────────────────────────────────────────

export default function POILayer({
  visible = true,
  activeFilter = null,
  onPlaceSelect,
}: POILayerProps) {
  const map = useMap();
  const [pois, setPOIs] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(map.getZoom());
  const [viewCenter, setViewCenter] = useState<Coordinate>(() => {
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  });
  const fetchRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useMapEvents({
    zoomend: () => {
      setZoom(map.getZoom());
      const c = map.getCenter();
      setViewCenter({ lat: c.lat, lng: c.lng });
    },
    moveend: () => {
      // Debounce pan movements to avoid rapid re-fetches during scrolling
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const c = map.getCenter();
        setViewCenter({ lat: c.lat, lng: c.lng });
      }, 400);
    },
  });

  // Calculate viewport radius from map bounds
  const viewportRadius = useMemo(() => {
    const bounds = map.getBounds();
    const center = bounds.getCenter();
    const ne = bounds.getNorthEast();
    const R = 6371e3;
    const dLat = ((ne.lat - center.lat) * Math.PI) / 180;
    const dLng = ((ne.lng - center.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((center.lat * Math.PI) / 180) * Math.cos((ne.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return Math.min(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, viewCenter]);

  // Coarser grid snap to drastically reduce re-fetches
  // Grid snap at ~1km resolution to minimize API calls
  const gridLat = Math.round(viewCenter.lat * 100) / 100;
  const gridLng = Math.round(viewCenter.lng * 100) / 100;

  useEffect(() => {
    if (!visible) {
      setPOIs([]);
      return;
    }

    const fetchId = ++fetchRef.current;
    const fetchPOIs = async () => {
      setLoading(true);
      try {
        // Use Geoapify category strings; when filter active, use specific categories
        const cats = activeFilter && FILTER_CATEGORIES[activeFilter]
          ? [FILTER_CATEGORIES[activeFilter]]
          : undefined; // undefined = use default broad categories
        const { pois: results } = await getNearbyPOIs(
          { lat: gridLat, lng: gridLng },
          Math.min(viewportRadius, 5000),
          cats,
        );
        if (fetchRef.current === fetchId) setPOIs(results);
      } catch {
        // silently fail
      }
      if (fetchRef.current === fetchId) setLoading(false);
    };

    fetchPOIs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridLat, gridLng, viewportRadius, visible, activeFilter]);

  const handleClick = useCallback(
    (poi: POI) => {
      if (onPlaceSelect) onPlaceSelect(poi);
    },
    [onPlaceSelect],
  );

  // Render markers with hierarchy: filter matches on top, then by importance
  const markers = useMemo(() => {
    if (!visible || loading || pois.length === 0) return null;

    // Sort: filter matches first, then by importance
    const sorted = [...pois].sort((a, b) => {
      if (activeFilter) {
        const aMatch = matchesFilter(a, activeFilter);
        const bMatch = matchesFilter(b, activeFilter);
        if (aMatch !== bMatch) return aMatch ? -1 : 1;
      }
      return getImportance(b) - getImportance(a);
    });

    // Limit visible count by zoom (famous places only when zoomed out)
    const maxCount =
      zoom >= 17 ? sorted.length
      : zoom >= 15 ? Math.min(sorted.length, 30)
      : zoom >= 13 ? Math.min(sorted.length, 15)
      : Math.min(sorted.length, 8);

    const visiblePois = sorted.slice(0, maxCount);

    return visiblePois.map((poi) => {
      const isDimmed = activeFilter ? !matchesFilter(poi, activeFilter) : false;
      const isHighlighted = activeFilter ? matchesFilter(poi, activeFilter) : false;
      // Highlighted POIs show labels at lower zoom, dimmed ones never show labels
      const showLabel = isHighlighted ? zoom >= 13 : !isDimmed && zoom >= 15;
      const showRating = isHighlighted ? zoom >= 15 : zoom >= 17;

      return (
        <Marker
          key={poi.id}
          position={[poi.coordinate.lat, poi.coordinate.lng]}
          icon={getIcon(poi.category, zoom, isDimmed, poi.types)}
          zIndexOffset={isHighlighted ? 1000 : isDimmed ? -1000 : 0}
          eventHandlers={{ click: () => handleClick(poi) }}
        >
          {showLabel && (
            <Tooltip
              permanent
              direction="bottom"
              offset={[0, 6]}
              className="poi-label-tooltip"
            >
              <span className="poi-label-name">{truncName(poi.name)}</span>
              {showRating && poi.rating != null && (
                <span className="poi-label-rating">
                  {'★'} {poi.rating.toFixed(1)}
                </span>
              )}
            </Tooltip>
          )}
        </Marker>
      );
    });
  }, [pois, visible, loading, zoom, activeFilter, handleClick]);

  return <>{markers}</>;
}
