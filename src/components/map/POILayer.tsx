import { useEffect, useState, useMemo, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import type { POI } from '../../lib/poi-api';
import { getNearbyPOIs } from '../../lib/poi-api';
import type { Coordinate } from '../../types';

interface POILayerProps {
  visible?: boolean;
  activeFilter?: string | null;
  poisRef?: React.MutableRefObject<POI[]>;
}

// ── Category filter → Geoapify categories ────────────────────────────

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

// ── Data-only POI fetcher ────────────────────────────────────────────
// No visual rendering — tile handles all POI visuals.
// This component only fetches POI data into memory so that
// MapClickHandler can do instant local lookup on tap.

export default function POILayer({
  visible = true,
  activeFilter = null,
  poisRef,
}: POILayerProps) {
  const map = useMap();
  const [pois, setPOIs] = useState<POI[]>([]);
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

  // Grid snap — finer at high zoom for better multi-cell coverage
  const gridSnap = zoom >= 15 ? 200 : 100;
  const gridLat = Math.round(viewCenter.lat * gridSnap) / gridSnap;
  const gridLng = Math.round(viewCenter.lng * gridSnap) / gridSnap;

  const cellsKey = `${zoom >= 15 ? 4 : 1}_${gridLat}_${gridLng}_${Math.round(viewportRadius)}`;

  useEffect(() => {
    if (!visible) {
      setPOIs([]);
      return;
    }

    const fetchId = ++fetchRef.current;
    const fetchPOIs = async () => {
      try {
        const cats = activeFilter && FILTER_CATEGORIES[activeFilter]
          ? [FILTER_CATEGORIES[activeFilter]]
          : undefined;

        let allPOIs: POI[];

        if (zoom >= 15) {
          // 2×2 grid fetch for wider POI coverage at high zoom
          const off = 0.003;
          const cellRadius = Math.min(viewportRadius * 0.8, 5000);
          const centers = [
            { lat: gridLat + off, lng: gridLng - off },
            { lat: gridLat + off, lng: gridLng + off },
            { lat: gridLat - off, lng: gridLng - off },
            { lat: gridLat - off, lng: gridLng + off },
          ];
          const results = await Promise.all(
            centers.map(c => getNearbyPOIs(c, cellRadius, cats))
          );
          const seen = new Set<string>();
          allPOIs = [];
          for (const { pois: cellPois } of results) {
            for (const poi of cellPois) {
              if (!seen.has(poi.id)) {
                seen.add(poi.id);
                allPOIs.push(poi);
              }
            }
          }
        } else {
          const { pois: results } = await getNearbyPOIs(
            { lat: gridLat, lng: gridLng },
            Math.min(viewportRadius * 1.3, 5000),
            cats,
          );
          allPOIs = results;
        }

        if (fetchRef.current === fetchId) setPOIs(allPOIs);
      } catch {
        // silently fail
      }
    };

    fetchPOIs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsKey, visible, activeFilter]);

  // Sync POIs to ref for MapClickHandler tap-to-identify
  useEffect(() => {
    if (poisRef) poisRef.current = pois;
  }, [pois, poisRef]);

  // Data-only — no visual rendering
  return null;
}
