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
  mapStyle?: string;
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

// ── Geoapify Marker Icon API ─────────────────────────────────────────

const GEOAPIFY_KEY = '983da66a10e14f909057351679defe36';

const CATEGORY_ICON_MAP: Record<string, { fa: string; color: string }> = {
  restaurant: { fa: 'utensils', color: 'f97316' },
  fast_food: { fa: 'utensils', color: 'ef4444' },
  cafe: { fa: 'coffee', color: '92400e' },
  coffee_shop: { fa: 'coffee', color: '92400e' },
  coffee: { fa: 'coffee', color: '92400e' },
  bakery: { fa: 'birthday-cake', color: 'd97706' },
  bar: { fa: 'glass-martini-alt', color: '7c3aed' },
  pub: { fa: 'beer', color: '7c3aed' },
  hotel: { fa: 'bed', color: '6366f1' },
  guest_house: { fa: 'bed', color: '6366f1' },
  hostel: { fa: 'bed', color: '6366f1' },
  accommodation: { fa: 'bed', color: '6366f1' },
  park: { fa: 'tree', color: '16a34a' },
  playground: { fa: 'child', color: '16a34a' },
  garden: { fa: 'tree', color: '16a34a' },
  commercial: { fa: 'shopping-bag', color: 'eab308' },
  shop: { fa: 'shopping-bag', color: 'eab308' },
  store: { fa: 'store', color: 'eab308' },
  supermarket: { fa: 'shopping-cart', color: '22c55e' },
  convenience: { fa: 'store', color: '22c55e' },
  clothes: { fa: 'tshirt', color: 'ec4899' },
  mosque: { fa: 'mosque', color: '10b981' },
  islam: { fa: 'mosque', color: '10b981' },
  church: { fa: 'church', color: '8b5cf6' },
  place_of_worship: { fa: 'praying-hands', color: '8b5cf6' },
  atm: { fa: 'money-bill-alt', color: '6366f1' },
  bank: { fa: 'university', color: '6366f1' },
  financial: { fa: 'money-bill-alt', color: '6366f1' },
  fuel: { fa: 'gas-pump', color: 'f59e0b' },
  gas: { fa: 'gas-pump', color: 'f59e0b' },
  pharmacy: { fa: 'pills', color: 'ef4444' },
  hospital: { fa: 'hospital', color: 'ef4444' },
  clinic: { fa: 'clinic-medical', color: 'ef4444' },
  cinema: { fa: 'film', color: 'ec4899' },
  museum: { fa: 'landmark', color: '8b5cf6' },
  library: { fa: 'book', color: '6366f1' },
  school: { fa: 'graduation-cap', color: '3b82f6' },
  university: { fa: 'university', color: '3b82f6' },
  gym: { fa: 'dumbbell', color: '14b8a6' },
  spa: { fa: 'spa', color: '14b8a6' },
  salon: { fa: 'cut', color: 'ec4899' },
  parking: { fa: 'parking', color: '6b7280' },
  tourism: { fa: 'camera', color: 'f59e0b' },
  entertainment: { fa: 'star', color: 'ec4899' },
  default: { fa: 'map-marker-alt', color: '6b7280' },
};

function findCategoryIcon(category: string, types?: string[]): { fa: string; color: string } {
  const lower = category.toLowerCase();
  if (CATEGORY_ICON_MAP[lower]) return CATEGORY_ICON_MAP[lower];
  if (types) {
    for (const t of types) {
      if (CATEGORY_ICON_MAP[t.toLowerCase()]) return CATEGORY_ICON_MAP[t.toLowerCase()];
    }
  }
  for (const [key, val] of Object.entries(CATEGORY_ICON_MAP)) {
    if (key !== 'default' && lower.includes(key)) return val;
  }
  if (types) {
    for (const t of types) {
      for (const [key, val] of Object.entries(CATEGORY_ICON_MAP)) {
        if (key !== 'default' && t.toLowerCase().includes(key)) return val;
      }
    }
  }
  return CATEGORY_ICON_MAP.default;
}

// ── Geoapify marker icon factory ─────────────────────────────────────

const iconCache = new Map<string, L.DivIcon>();

// Pin dimensions per Geoapify size
const PIN_DIMS: Record<string, [number, number]> = {
  small: [25, 37],
  medium: [31, 46],
  large: [38, 56],
};

function getIcon(
  category: string,
  zoom: number,
  dimmed: boolean,
  types?: string[],
  isSatellite = false,
): L.DivIcon {
  const { fa, color } = findCategoryIcon(category, types);
  const size: 'small' | 'medium' | 'large' =
    zoom >= 16 ? 'large' : zoom >= 14 ? 'medium' : 'small';

  const satKey = isSatellite ? 's' : 'n';
  const cacheKey = `${fa}_${color}_${size}_${dimmed ? 1 : 0}_${satKey}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const pinColor = isSatellite && !dimmed ? 'ffffff' : color;
  const strokeColor = isSatellite ? '333333' : 'ffffff';
  const url = `https://api.geoapify.com/v1/icon/?type=material&color=%23${pinColor}&size=${size}&icon=${fa}&iconType=awesome&strokeColor=%23${strokeColor}&apiKey=${GEOAPIFY_KEY}`;

  const [w, h] = PIN_DIMS[size];
  const opacity = dimmed ? 0.3 : 1;
  const filter = dimmed
    ? 'grayscale(60%)'
    : isSatellite
      ? 'drop-shadow(0 0 6px rgba(255,255,255,0.85)) drop-shadow(0 2px 4px rgba(0,0,0,0.6))'
      : 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))';

  const icon = L.divIcon({
    className: '',
    html: `<img src="${url}" width="${w}" height="${h}" style="opacity:${opacity};filter:${filter};transition:transform .12s ease,opacity .2s ease;cursor:pointer;" onmouseover="this.style.transform='scale(1.18)'" onmouseout="this.style.transform='scale(1)'" loading="lazy" />`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    tooltipAnchor: [0, -h + 8],
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
  mapStyle = 'voyager',
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
      const isSat = mapStyle === 'satellite';
      // Highlighted POIs show labels at lower zoom, dimmed ones never show labels
      const showLabel = isHighlighted ? zoom >= 13 : !isDimmed && zoom >= 15;
      const showRating = isHighlighted ? zoom >= 15 : zoom >= 17;

      return (
        <Marker
          key={poi.id}
          position={[poi.coordinate.lat, poi.coordinate.lng]}
          icon={getIcon(poi.category, zoom, isDimmed, poi.types, isSat)}
          zIndexOffset={isHighlighted ? 1000 : isDimmed ? -1000 : 0}
          eventHandlers={{ click: () => handleClick(poi) }}
        >
          {showLabel && (
            <Tooltip
              permanent
              direction="bottom"
              offset={[0, 6]}
              className={`poi-label-tooltip${isSat ? ' poi-satellite' : ''}`}
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
