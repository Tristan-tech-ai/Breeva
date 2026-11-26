import Supercluster from 'supercluster';
import type { POI } from './poi-api';
import { resolvePriority, merchantPriority } from './poi-icons';
import { thinPoints } from './poiThin';

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

// The index is queried at zoom 21, above maxZoom, so it never returns clusters: it is a spatial index and the
// marker budget lives in poiThin.ts. minZoom = maxZoom keeps load() to the point tree plus one cluster pass instead
// of one pass per zoom 0-20 (N-67: within/_cluster inside the first pinch on /home).
const index = new Supercluster<PointProps, Record<string, never>>({
  radius: 60,
  minZoom: 20,
  maxZoom: 20,
  minPoints: 3,
});

// Hard render budget: cap individual (non-cluster) markers per viewport so dense areas
// never spawn hundreds of DOM markers. The most-important POIs (merchants, low priority
// number) are kept; the long tail stays clustered / reappears as you zoom in. Mirrors how
// Google shows labels for key places + clusters the rest, staying interactive + smooth.
// F1-70: marker budget and spacing live in poiThin.ts (pure, tested in node)

let loadedSerial = -1;
let loadedShowMerchants = true;
let loadedGreenOnly = false;
let loads = 0;
let poiLookup = new Map<string, POI>();

/** True when the POI set changed since the last build (the zoom is not part of the key: N-67). */
export function needsReindex(serial: number, showMerchants = true, greenOnly = false): boolean {
  return !(serial === loadedSerial && showMerchants === loadedShowMerchants && greenOnly === loadedGreenOnly);
}

/** How many times the index was built (tests). */
export function indexLoads(): number {
  return loads;
}

/**
 * Build the spatial index once per POI set. Every POI enters with its priority tier; the tier is applied at query
 * time (getVisibleFeatures). N-67: the index used to be rebuilt each time a pinch crossed an integer zoom, which put
 * a load of up to 37,548 points inside the gesture (/home longest task 185-213 ms at CPU 6x).
 */
export function reindex(pois: POI[], serial: number, showMerchants = true, greenOnly = false): void {
  // showMerchants + greenOnly are part of the cache key: POILayer pre-filters `pois` (drops merchants / keeps only
  // green spaces), but the serial does not change when a toggle flips
  if (!needsReindex(serial, showMerchants, greenOnly)) return;
  loadedSerial = serial;
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
  loads++;
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
  showAll = false,
): ClusterFeature[] {
  const tier = Math.floor(zoom);
  // above the index's maxZoom Supercluster returns every point unclustered; thinPoints spaces them instead
  const raw = index.getClusters([west, south, east, north], 21);
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
      // POIs whose priority tier is above the current zoom stay hidden (unless showAll)
      if (!showAll && (props.priority ?? 99) > tier) continue;
      const poi = poiLookup.get(props.poiId);
      if (poi) {
        points.push({ type: 'point', poi, lng, lat, id: poi.id, _priority: props.priority ?? 99 });
      }
    }
  }

  // the most important markers, spaced apart, at most MAX_RENDER_POINTS (F1-70); no cluster bubbles
  return [...clusters, ...thinPoints(points, zoom)]; // points carry a harmless extra _priority field
}
