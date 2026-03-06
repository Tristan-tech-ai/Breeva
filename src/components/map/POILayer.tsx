import { useEffect, useState, useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import type { Coordinate } from '../../types';
import type { POI } from '../../lib/poi-api';
import { getNearbyPOIs } from '../../lib/poi-api';
import { getCategoryStyle } from '../../lib/foursquare-api';

interface POILayerProps {
  center: Coordinate;
  radiusMeters?: number;
  categories?: string[];
  visible?: boolean;
  onPlaceSelect?: (poi: POI) => void;
}

// Build a colored divIcon for a category
function makePOIIcon(emoji: string, color: string) {
  return L.divIcon({
    className: 'custom-poi-marker',
    html: `<div style="
      width:30px;height:30px;
      background:${color};
      border:2.5px solid white;
      border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      display:flex;align-items:center;justify-content:center;
      font-size:14px;line-height:1;
      cursor:pointer;
    ">${emoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// Cache icons so we don't recreate them every render
const iconCache = new Map<string, L.DivIcon>();
function getIcon(category: string): L.DivIcon {
  if (iconCache.has(category)) return iconCache.get(category)!;
  const { emoji, color } = getCategoryStyle(category);
  const icon = makePOIIcon(emoji, color);
  iconCache.set(category, icon);
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
      const { pois: results } = await getNearbyPOIs(
        { lat: gridLat, lng: gridLng },
        radiusMeters,
        categories,
      );
      if (!cancelled) {
        setPOIs(results);
        setLoading(false);
      }
    };

    fetchPOIs();
    return () => { cancelled = true; };
  }, [gridLat, gridLng, radiusMeters, categories?.join(','), visible]);

  // Memoize markers to avoid unnecessary re-renders
  const markers = useMemo(() => {
    if (!visible || loading) return null;
    return pois.map((poi) => (
      <Marker
        key={poi.id}
        position={[poi.coordinate.lat, poi.coordinate.lng]}
        icon={getIcon(poi.category)}
        eventHandlers={
          onPlaceSelect
            ? { click: () => onPlaceSelect(poi) }
            : undefined
        }
      />
    ));
  }, [pois, visible, loading, onPlaceSelect]);

  return <>{markers}</>;
}
