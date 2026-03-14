/**
 * Client-side spatial tile cache with LRU eviction and TTL.
 *
 * Key idea: quantize bounding boxes to a zoom-dependent grid so that
 * small pans reuse the same cache entry instead of triggering new HTTP
 * requests. Supports stale-while-revalidate: returns expired entries
 * so callers can render immediately while fetching fresh data.
 */

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  tileKey: string;
}

export class SpatialTileCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 50, ttlMinutes = 5) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMinutes * 60_000;
  }

  /** Quantize bbox to tile key so small pans hit the same cell. */
  private tileKey(
    south: number,
    west: number,
    _north: number,
    _east: number,
    zoom: number,
  ): string {
    // Step = viewport-ish span per zoom. Quantize the SW corner.
    const step = 180 / Math.pow(2, zoom);
    const qs = Math.floor(south / step) * step;
    const qw = Math.floor(west / step) * step;
    return `${zoom}:${qs.toFixed(4)}:${qw.toFixed(4)}`;
  }

  /** Get fresh entry, or null. */
  get(
    south: number,
    west: number,
    north: number,
    east: number,
    zoom: number,
  ): T | null {
    const key = this.tileKey(south, west, north, east, zoom);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > this.ttlMs) return null;
    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  /** Get stale entry (expired but present) for instant rendering. */
  getStale(
    south: number,
    west: number,
    north: number,
    east: number,
    zoom: number,
  ): T | null {
    const key = this.tileKey(south, west, north, east, zoom);
    const entry = this.cache.get(key);
    return entry?.data ?? null;
  }

  set(
    south: number,
    west: number,
    north: number,
    east: number,
    zoom: number,
    data: T,
  ): void {
    const key = this.tileKey(south, west, north, east, zoom);
    this.cache.delete(key); // refresh position
    this.cache.set(key, { data, fetchedAt: Date.now(), tileKey: key });
    // LRU eviction
    if (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
