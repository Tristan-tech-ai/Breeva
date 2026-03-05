import { useEffect, useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, Phone, Globe, Star } from 'lucide-react';
import type { Coordinate } from '../../types';
import type { POI } from '../../lib/poi-api';
import { getNearbyPOIs } from '../../lib/poi-api';

interface POILayerProps {
  center: Coordinate;
  radiusMeters?: number;
  categories?: string[];
  visible?: boolean;
}

// Custom icon for POI markers
const poiIcon = L.divIcon({
  className: 'custom-poi-marker',
  html: `
    <div style="
      width: 24px;
      height: 24px;
      background: #3b82f6;
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 12px;
    ">
      📍
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export default function POILayer({ center, radiusMeters = 1000, categories, visible = true }: POILayerProps) {
  const [pois, setPOIs] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPOIs([]);
      return;
    }

    const fetchPOIs = async () => {
      setLoading(true);
      const { pois: results } = await getNearbyPOIs(center, radiusMeters, categories);
      setPOIs(results);
      setLoading(false);
    };

    fetchPOIs();
  }, [center.lat, center.lng, radiusMeters, categories?.join(','), visible]);

  if (!visible || loading) return null;

  return (
    <>
      {pois.map((poi) => (
        <Marker
          key={poi.id}
          position={[poi.coordinate.lat, poi.coordinate.lng]}
          icon={poiIcon}
        >
          <Popup>
            <div className="p-2 min-w-[200px]">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white mb-1">
                {poi.name}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{poi.category}</p>
              
              {poi.address && (
                <div className="flex items-start gap-1.5 mb-1">
                  <MapPin size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-gray-600 dark:text-gray-300">{poi.address}</p>
                </div>
              )}

              {poi.rating && (
                <div className="flex items-center gap-1 mb-1">
                  <Star size={12} className="text-amber-400" fill="currentColor" />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {poi.rating.toFixed(1)}
                  </span>
                </div>
              )}

              {poi.phone && (
                <div className="flex items-center gap-1.5 mb-1">
                  <Phone size={12} className="text-gray-400" />
                  <a
                    href={`tel:${poi.phone}`}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    {poi.phone}
                  </a>
                </div>
              )}

              {poi.website && (
                <div className="flex items-center gap-1.5 mb-1">
                  <Globe size={12} className="text-gray-400" />
                  <a
                    href={poi.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary-600 hover:underline"
                  >
                    Visit website
                  </a>
                </div>
              )}

              {poi.distance && (
                <p className="text-[10px] text-gray-400 mt-2">
                  {poi.distance < 1000
                    ? `${Math.round(poi.distance)} m away`
                    : `${(poi.distance / 1000).toFixed(1)} km away`}
                </p>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
