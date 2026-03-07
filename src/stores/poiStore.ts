import { create } from 'zustand';
import type { POI } from '../lib/poi-api';
import { getPOIsInRect } from '../lib/poi-api';
import { diagStart, diagEnd, diagLog, diagFetchSummary } from '../lib/poi-diagnostics';

// ── Tile math (slippy-map convention) ────────────────────────────────

/** Base fetch zoom for wide coverage */
const FETCH_ZOOM = 14;
/** Detail fetch zoom — used for deep zoom to get full POI density */
const DETAIL_ZOOM = 16;
const TILE_BUFFER = 0;
const MAX_TILES_PER_FETCH = 16;
/** Zoom level at which detail fetching kicks in */
const DETAIL_ZOOM_THRESHOLD = 17;

function lng2tile(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function lat2tile(lat: number, z: number): number {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) +
          1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      Math.pow(2, z),
  );
}

function tile2lng(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileKey(x: number, y: number, z: number = FETCH_ZOOM): string {
  return `${z}_${x}_${y}`;
}

/** SW/NE bounds of a tile */
function tileBounds(x: number, y: number, z: number = FETCH_ZOOM): { west: number; south: number; east: number; north: number } {
  return {
    west: tile2lng(x, z),
    south: tile2lat(y + 1, z),
    east: tile2lng(x + 1, z),
    north: tile2lat(y, z),
  };
}

// ── Per-filter cache entry ─────────────────────────────────────────

interface FilterCacheEntry {
  allPOIs: Map<string, POI>;
  fetchedTiles: Set<string>;
}

// ── Types ────────────────────────────────────────────────────────────

interface POIStoreState {
  /** Master POI registry — keyed by poi.id */
  allPOIs: Map<string, POI>;
  /** Tiles that are already fetched or in-flight */
  fetchedTiles: Set<string>;
  /** Tiles currently being fetched (to avoid duplicate requests) */
  inflightTiles: Set<string>;
  /** Serial bumped whenever allPOIs changes (to trigger Supercluster reindex) */
  serial: number;
  /** Active category filter string (Geoapify format) or null */
  activeFilter: string | null;
  /** Fetch generation — bumped on filter change to invalidate stale in-flight requests */
  _fetchGen: number;
  /** Per-filter cache — stores POIs + tiles for previously visited filters */
  _filterCache: Map<string, FilterCacheEntry>;

  /** Compute tile keys covering a viewport, fetch any new ones */
  fetchForViewport: (bounds: L.LatLngBounds, zoom: number, filterCats?: string[]) => void;
  /** Change active filter — clears all POI data and refetches */
  setFilter: (filter: string | null, filterCats?: string[]) => void;
  /** Get a flat array snapshot of all known POIs */
  getPOIArray: () => POI[];
}

export const usePoiStore = create<POIStoreState>((set, get) => ({
  allPOIs: new Map(),
  fetchedTiles: new Set(),
  inflightTiles: new Set(),
  serial: 0,
  activeFilter: null,
  _fetchGen: 0,
  _filterCache: new Map(),

  fetchForViewport(bounds, zoom, filterCats) {
    if (zoom < 14) return;

    const { fetchedTiles, inflightTiles } = get();

    // Always fetch base z14 tiles
    const fetchAtZoom = (z: number) => {
      const xMin = lng2tile(bounds.getWest(), z) - TILE_BUFFER;
      const xMax = lng2tile(bounds.getEast(), z) + TILE_BUFFER;
      const yMin = lat2tile(bounds.getNorth(), z) - TILE_BUFFER;
      const yMax = lat2tile(bounds.getSouth(), z) + TILE_BUFFER;

      const tiles: { x: number; y: number; key: string; z: number }[] = [];
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const key = tileKey(x, y, z);
          if (!fetchedTiles.has(key) && !inflightTiles.has(key)) {
            tiles.push({ x, y, key, z });
          }
        }
      }
      return tiles;
    };

    let tilesToFetch = fetchAtZoom(FETCH_ZOOM);

    // At deep zoom, also fetch z16 detail tiles for full density
    if (zoom >= DETAIL_ZOOM_THRESHOLD) {
      const detailTiles = fetchAtZoom(DETAIL_ZOOM);
      tilesToFetch = [...tilesToFetch, ...detailTiles];
    }

    if (tilesToFetch.length === 0) return;

    // Cap tiles to prevent excessive API calls on very wide viewports
    if (tilesToFetch.length > MAX_TILES_PER_FETCH) {
      tilesToFetch.length = MAX_TILES_PER_FETCH;
    }

    diagLog('fetchForViewport', { tiles: tilesToFetch.length, zoom, filter: get().activeFilter });
    diagStart('fetch-cycle');

    // Mark as in-flight immediately
    const newInflight = new Set(inflightTiles);
    for (const t of tilesToFetch) newInflight.add(t.key);
    set({ inflightTiles: newInflight });

    const gen = get()._fetchGen;

    // ── Progressive flush: coalesce results arriving within the same frame ──
    // Instead of waiting for ALL tiles, we flush as tiles complete.
    // A rAF-based coalescion merges tiles finishing within the same frame.
    let pendingResults: Array<{ key: string; pois: POI[] }> = [];
    let flushScheduled = false;
    const tileTimings: number[] = [];

    const flushPending = () => {
      flushScheduled = false;
      if (get()._fetchGen !== gen || pendingResults.length === 0) return;

      diagStart('batch-apply');
      const batch = pendingResults;
      pendingResults = [];

      const state = get();
      const newAll = new Map(state.allPOIs);
      const newFetched = new Set(state.fetchedTiles);
      const newFlight = new Set(state.inflightTiles);

      for (const r of batch) {
        for (const poi of r.pois) newAll.set(poi.id, poi);
        newFetched.add(r.key);
        newFlight.delete(r.key);
      }

      set({
        allPOIs: newAll,
        fetchedTiles: newFetched,
        inflightTiles: newFlight,
        serial: state.serial + 1,
      });
      diagEnd('batch-apply', { tilesInBatch: batch.length, totalPOIs: newAll.size });
    };

    const scheduleFlush = () => {
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flushPending);
      }
    };

    const fetchTile = async (t: { x: number; y: number; key: string; z: number }) => {
      const t0 = performance.now();
      try {
        const bounds = tileBounds(t.x, t.y, t.z);
        const { pois } = await getPOIsInRect(bounds, filterCats);
        const elapsed = performance.now() - t0;
        tileTimings.push(elapsed);
        diagLog(`tile ${t.key}`, { ms: Math.round(elapsed), pois: pois.length });

        if (get()._fetchGen !== gen) return;
        pendingResults.push({ key: t.key, pois });
        scheduleFlush();
      } catch {
        diagLog(`tile ${t.key} FAILED`, { ms: Math.round(performance.now() - t0) });
        if (get()._fetchGen !== gen) return;
        const state = get();
        const nf = new Set(state.inflightTiles);
        nf.delete(t.key);
        set({ inflightTiles: nf });
      }
    };

    // Concurrency-limited execution (max 6 concurrent for faster saturation)
    const queue = [...tilesToFetch];
    let active = 0;
    const runNext = () => {
      while (active < 6 && queue.length > 0) {
        const t = queue.shift()!;
        active++;
        fetchTile(t).then(() => {
          active--;
          runNext();
          // Log summary when all tiles are done
          if (active === 0 && queue.length === 0) {
            diagEnd('fetch-cycle', { totalTiles: tilesToFetch.length });
            diagFetchSummary({
              totalTiles: tilesToFetch.length,
              cachedTiles: tilesToFetch.length - tileTimings.length,
              networkTiles: tileTimings.length,
              tileTimings,
              totalMs: tileTimings.length > 0 ? Math.max(...tileTimings) : 0,
            });
          }
        });
      }
    };
    runNext();
  },

  setFilter(filter, _filterCats) {
    const prev = get().activeFilter;
    if (filter === prev) return;

    const state = get();
    const cache = new Map(state._filterCache);
    const prevKey = prev ?? '__all__';

    // Save current filter's data to cache (if there's anything to save)
    if (state.allPOIs.size > 0) {
      cache.set(prevKey, {
        allPOIs: state.allPOIs,
        fetchedTiles: state.fetchedTiles,
      });
    }

    // Check if we have cached data for the new filter
    const newKey = filter ?? '__all__';
    const cached = cache.get(newKey);

    if (cached) {
      // Instant restore from cache — zero API calls
      set({
        activeFilter: filter,
        allPOIs: cached.allPOIs,
        fetchedTiles: cached.fetchedTiles,
        inflightTiles: new Set(),
        serial: state.serial + 1,
        _fetchGen: state._fetchGen + 1,
        _filterCache: cache,
      });
    } else {
      // No cache — clear and start fresh
      set({
        activeFilter: filter,
        allPOIs: new Map(),
        fetchedTiles: new Set(),
        inflightTiles: new Set(),
        serial: state.serial + 1,
        _fetchGen: state._fetchGen + 1,
        _filterCache: cache,
      });
    }
  },

  getPOIArray() {
    return Array.from(get().allPOIs.values());
  },
}));
