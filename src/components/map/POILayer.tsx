import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Marker, useMap, useMapEvents } from 'react-leaflet';
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

function getHitIcon(zoom: number): L.DivIcon {
  // Circle for icon + tall rectangle below for label text
  const circle = zoom >= 16 ? 52 : zoom >= 14 ? 42 : 32;
  const textW = zoom >= 16 ? 80 : zoom >= 14 ? 70 : 56;
  const textH = zoom >= 16 ? 28 : zoom >= 14 ? 22 : 18;
  const totalW = Math.max(circle, textW);
  const totalH = circle + textH + 2; // 2px gap

  const cacheKey = `hit_${circle}_${textW}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${totalW}px;height:${totalH}px;cursor:pointer;display:flex;flex-direction:column;align-items:center;">
      <div style="width:${circle}px;height:${circle}px;border-radius:50%;" />
      <div style="width:${textW}px;height:${textH}px;border-radius:4px;" />
    </div>`,
    iconSize: [totalW, totalH],
    iconAnchor: [totalW / 2, circle / 2],
  });

  iconCache.set(cacheKey, icon);
  return icon;
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

  // Pure invisible hit areas — no visual, just clickable targets over tile icons
  const markers = useMemo(() => {
    if (!visible || loading || pois.length === 0) return null;

    return pois.map((poi) => (
      <Marker
        key={poi.id}
        position={[poi.coordinate.lat, poi.coordinate.lng]}
        icon={getHitIcon(zoom)}
        zIndexOffset={0}
        eventHandlers={{ click: () => handleClick(poi) }}
      />
    ));
  }, [pois, visible, loading, zoom, handleClick]);

  return <>{markers}</>;
}
