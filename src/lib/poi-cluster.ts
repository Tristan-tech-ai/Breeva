import Supercluster from 'supercluster';
import type { POI } from './poi-api';
import { resolvePriority, merchantPriority } from './poi-icons';

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
  maxZoom: 20,     // keep clustering dense pockets up to z20 — caps marker count in dense
                   // cities (Jakarta) instead of exploding into hundreds of DOM markers at z18+
  minPoints: 3,    // need 3+ to form a cluster
});

// Hard render budget: cap individual (non-cluster) markers per viewport so dense areas
// never spawn hundreds of DOM markers. The most-important POIs (merchants, low priority
// number) are kept; the long tail stays clustered / reappears as you zoom in. Mirrors how
// Google shows labels for key places + clusters the rest, staying interactive + smooth.
const MAX_RENDER_POINTS = 120;

let loadedSerial = -1;
let loadedZoom = -1;
let loadedShowMerchants = true;
let loadedGreenOnly = false;
let poiLookup = new Map<string, POI>();

/**
 * Re-index the Supercluster with POIs filtered by priority at the given zoom.
 * Only priority-eligible POIs enter the index — the rest are simply hidden
 * (no cluster bubbles for off-screen-tier POIs).
 */
export function reindex(pois: POI[], serial: number, zoom: number, showAll: boolean, showMerchants = true, greenOnly = false): void {
  const effectiveZoom = Math.floor(zoom);
  // showMerchants + greenOnly are part of the cache key: POILayer pre-filters `pois`
  // (drops merchants / keeps only green spaces), but serial/zoom don't change when a
  // toggle flips — without this the memoized index would keep the stale set.
  if (serial === loadedSerial && effectiveZoom === loadedZoom
      && showMerchants === loadedShowMerchants && greenOnly === loadedGreenOnly) return;
  loadedSerial = serial;
  loadedZoom = effectiveZoom;
  loadedShowMerchants = showMerchants;
  loadedGreenOnly = greenOnly;

  poiLookup = new Map<string, POI>();
  const features: GeoJSON.Feature<GeoJSON.Point, PointProps>[] = [];

  for (const poi of pois) {
    // Merchant POIs use their own priority based on sponsor tier boost
    const mp = poi as POI & { _isMerchant?: boolean; _priorityBoost?: number };
    const priority = mp._isMerchant
      ? merchantPriority(mp._priorityBoost || 0)
      : resolvePriority(poi.types || []);
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
  const clusters: ClusterFeature[] = [];
  const points: Array<ClusterPoint & { _priority: number }> = [];

  for (const f of raw) {
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties as PointProps & {
      cluster?: boolean;
      cluster_id?: number;
      point_count?: number;
    };

    if (props.cluster) {
      clusters.push({
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
        points.push({ type: 'point', poi, lng, lat, id: poi.id, _priority: props.priority ?? 99 });
      }
    }
  }

  // Cap individual markers to the render budget — keep the most-important (lowest
  // priority number; merchants rank highest). Clusters are always kept (they expand on tap).
  if (points.length > MAX_RENDER_POINTS) {
    points.sort((a, b) => a._priority - b._priority);
    points.length = MAX_RENDER_POINTS;
  }

  return [...clusters, ...points]; // points carry a harmless extra _priority field
}
