import Supercluster from 'supercluster';
import type { POI } from './poi-api';
import { resolvePriority } from './poi-icons';

// ── Types ────────────────────────────────────────────────────────────

export interface ClusterPoint {
  type: 'point';
  poi: POI;
  lng: number;
  lat: number;
  id: string;
}

export interface ClusterGroup {
  type: 'cluster';
  id: number;
  lng: number;
  lat: number;
  count: number;
  expansionZoom: number;
}

export type ClusterFeature = ClusterPoint | ClusterGroup;

// ── Supercluster wrapper ─────────────────────────────────────────────

type PointProps = { poiId: string; name: string; category: string; priority: number };

const index = new Supercluster<PointProps, Record<string, never>>({
  radius: 60,     // cluster radius in pixels
  maxZoom: 17,     // individual points above z17
  minPoints: 3,    // need 3+ to form a cluster
});

let loadedSerial = -1;
let loadedZoom = -1;
let poiLookup = new Map<string, POI>();

/**
 * Re-index the Supercluster with POIs filtered by priority at the given zoom.
 * Only priority-eligible POIs enter the index — the rest are simply hidden
 * (no cluster bubbles for off-screen-tier POIs).
 */
export function reindex(pois: POI[], serial: number, zoom: number, showAll: boolean): void {
  const effectiveZoom = Math.floor(zoom);
  if (serial === loadedSerial && effectiveZoom === loadedZoom) return;
  loadedSerial = serial;
  loadedZoom = effectiveZoom;

  poiLookup = new Map<string, POI>();
  const features: GeoJSON.Feature<GeoJSON.Point, PointProps>[] = [];

  for (const poi of pois) {
    const priority = resolvePriority(poi.types || []);
    // Skip POIs whose priority tier is above current zoom (unless showAll)
    if (!showAll && priority > effectiveZoom) continue;

    poiLookup.set(poi.id, poi);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [poi.coordinate.lng, poi.coordinate.lat],
      },
      properties: {
        poiId: poi.id,
        name: poi.name,
        category: poi.category,
        priority,
      },
    });
  }

  index.load(features);
}

/**
 * Query visible clusters + points within a bounding box at the given zoom.
 */
export function getVisibleFeatures(
  west: number,
  south: number,
  east: number,
  north: number,
  zoom: number,
): ClusterFeature[] {
  const raw = index.getClusters([west, south, east, north], Math.floor(zoom));
  const result: ClusterFeature[] = [];

  for (const f of raw) {
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties as PointProps & {
      cluster?: boolean;
      cluster_id?: number;
      point_count?: number;
    };

    if (props.cluster) {
      result.push({
        type: 'cluster',
        id: props.cluster_id!,
        lng,
        lat,
        count: props.point_count!,
        expansionZoom: index.getClusterExpansionZoom(props.cluster_id!),
      });
    } else {
      const poi = poiLookup.get(props.poiId);
      if (poi) {
        result.push({
          type: 'point',
          poi,
          lng,
          lat,
          id: poi.id,
        });
      }
    }
  }

  return result;
}
