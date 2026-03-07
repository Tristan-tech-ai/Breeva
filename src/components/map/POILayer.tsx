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

// ── Invisible click-target icons ─────────────────────────────────────
// The Geoapify map tiles already render POI icons visually.
// We overlay transparent hit areas so users can tap them to see details.

const iconCache = new Map<string, L.DivIcon>();

function getHitIcon(zoom: number, dimmed: boolean): L.DivIcon {
  // Larger hit area at higher zoom for easier tapping
  const size = zoom >= 16 ? 40 : zoom >= 14 ? 32 : 24;
  const cacheKey = `hit_${size}_${dimmed ? 1 : 0}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;cursor:pointer;border-radius:50%;" />`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -(size / 2) + 4],
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
          icon={getHitIcon(zoom, isDimmed)}
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
