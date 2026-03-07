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

// ── Minimalist Breeva POI icons ──────────────────────────────────────
// Small colored dot + name label, like native map tile POI rendering

const CATEGORY_COLORS: Record<string, string> = {
  restaurant: '#f97316', fast_food: '#ef4444', food_court: '#f97316',
  cafe: '#92400e', coffee_shop: '#92400e', coffee: '#92400e',
  bakery: '#d97706', bar: '#7c3aed', pub: '#7c3aed',
  hotel: '#6366f1', guest_house: '#6366f1', hostel: '#6366f1', accommodation: '#6366f1',
  park: '#16a34a', playground: '#16a34a', garden: '#16a34a', national_park: '#16a34a',
  commercial: '#eab308', shop: '#eab308', store: '#eab308',
  supermarket: '#22c55e', convenience: '#22c55e', mall: '#eab308',
  mosque: '#10b981', islam: '#10b981', church: '#8b5cf6', place_of_worship: '#8b5cf6',
  atm: '#6366f1', bank: '#6366f1', financial: '#6366f1',
  fuel: '#f59e0b', gas_station: '#f59e0b',
  pharmacy: '#ef4444', hospital: '#ef4444', clinic: '#ef4444',
  cinema: '#ec4899', museum: '#8b5cf6', library: '#6366f1',
  school: '#3b82f6', university: '#3b82f6',
  gym: '#14b8a6', spa: '#14b8a6', salon: '#ec4899',
  parking: '#94a3b8', tourism: '#f59e0b', entertainment: '#ec4899',
};

function getCategoryColor(category: string, types?: string[]): string {
  const lower = category.toLowerCase();
  if (CATEGORY_COLORS[lower]) return CATEGORY_COLORS[lower];
  if (types) {
    for (const t of types) {
      if (CATEGORY_COLORS[t.toLowerCase()]) return CATEGORY_COLORS[t.toLowerCase()];
    }
  }
  for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
    if (lower.includes(key)) return val;
  }
  if (types) {
    for (const t of types) {
      for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
        if (t.toLowerCase().includes(key)) return val;
      }
    }
  }
  return '#94a3b8';
}

const iconCache = new Map<string, L.DivIcon>();

function getPoiIcon(color: string, zoom: number, dimmed: boolean): L.DivIcon {
  const dotSize = zoom >= 17 ? 10 : zoom >= 15 ? 8 : 6;
  const opacity = dimmed ? 0.25 : 1;
  const cacheKey = `${color}_${dotSize}_${dimmed ? 1 : 0}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${dotSize}px;height:${dotSize}px;background:${color};border-radius:50%;border:1.5px solid white;box-shadow:0 0 3px rgba(0,0,0,0.3);opacity:${opacity};cursor:pointer;transition:transform .1s ease;" onmouseover="this.style.transform='scale(1.4)'" onmouseout="this.style.transform='scale(1)'" />`,
    iconSize: [dotSize, dotSize],
    iconAnchor: [dotSize / 2, dotSize / 2],
  });

  iconCache.set(cacheKey, icon);
  return icon;
}

// ── Zoom-based visibility (mimics native tile POI rendering) ─────────
// Higher zoom = more POIs visible.

function getMaxVisible(zoom: number): number {
  if (zoom >= 18) return 200;
  if (zoom >= 17) return 80;
  if (zoom >= 16) return 50;
  if (zoom >= 15) return 30;
  if (zoom >= 14) return 15;
  if (zoom >= 13) return 8;
  return 4;
}

function truncName(name: string, maxLen = 16): string {
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

  // Render Breeva minimalist POI markers: small colored dot + name label
  const markers = useMemo(() => {
    if (!visible || loading || pois.length === 0) return null;

    // Sort by name length as importance proxy (major places = shorter names)
    const sorted = [...pois].sort((a, b) => {
      if (activeFilter) {
        const aM = matchesFilter(a, activeFilter);
        const bM = matchesFilter(b, activeFilter);
        if (aM !== bM) return aM ? -1 : 1;
      }
      return a.name.length - b.name.length;
    });

    const maxCount = getMaxVisible(zoom);
    const visible_ = sorted.slice(0, maxCount);
    const showLabel = zoom >= 15;

    return visible_.map((poi) => {
      const dimmed = activeFilter ? !matchesFilter(poi, activeFilter) : false;
      const color = getCategoryColor(poi.category, poi.types);

      return (
        <Marker
          key={poi.id}
          position={[poi.coordinate.lat, poi.coordinate.lng]}
          icon={getPoiIcon(color, zoom, dimmed)}
          zIndexOffset={dimmed ? -500 : 0}
          eventHandlers={{ click: () => handleClick(poi) }}
        >
          {showLabel && !dimmed && (
            <Tooltip
              permanent
              direction="bottom"
              offset={[0, 4]}
              className="poi-label-tooltip"
            >
              <span className="poi-label-name">{truncName(poi.name)}</span>
            </Tooltip>
          )}
        </Marker>
      );
    });
  }, [pois, visible, loading, zoom, activeFilter, handleClick]);

  return <>{markers}</>;
}
