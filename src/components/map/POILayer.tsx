import { useEffect, useRef, useCallback, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { POI } from '../../lib/poi-api';
import { usePoiStore } from '../../stores/poiStore';
import { reindex, getVisibleFeatures, type ClusterFeature } from '../../lib/poi-cluster';
import { resolveIcon, resolvePriority, getCategoryDivIcon, getClusterDivIcon } from '../../lib/poi-icons';
import { resolveLabels, type LabelCandidate } from '../../lib/label-collision';
import { diagStart, diagEnd } from '../../lib/poi-diagnostics';

// ── Category filter → Geoapify categories ────────────────────────────

export const FILTER_CATEGORIES: Record<string, { geoapify: string; foursquare: string }> = {
  restaurant: { geoapify: 'catering.restaurant,catering.fast_food', foursquare: '13065' },
  cafe: { geoapify: 'catering.cafe,catering.coffee_shop', foursquare: '13032,13034' },
  hotel: { geoapify: 'accommodation.hotel,accommodation.guest_house,accommodation.hostel', foursquare: '19014' },
  park: { geoapify: 'leisure.park,leisure.playground,national_park', foursquare: '16032' },
  shop: { geoapify: 'commercial', foursquare: '17069' },
  mosque: { geoapify: 'religion.place_of_worship.islam', foursquare: '12111' },
  atm: { geoapify: 'service.financial.atm,service.financial.bank', foursquare: '11045' },
  gas: { geoapify: 'service.vehicle.fuel', foursquare: '19007' },
};

// ── Filter chip colors (matches HomePage FILTER_CHIPS) ──────────────

const FILTER_CHIP_COLORS: Record<string, string> = {
  restaurant: '#ef4444',
  cafe:       '#92400e',
  hotel:      '#8b5cf6',
  park:       '#16a34a',
  shop:       '#f59e0b',
  mosque:     '#06b6d4',
  atm:        '#6366f1',
  gas:        '#ea580c',
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Get the appropriate DivIcon for a POI using hierarchical resolution */
function getPoiIcon(poi: POI, size: 'sm' | 'lg' = 'sm'): L.DivIcon {
  const { iconKey, color } = resolveIcon(poi.types || []);
  return getCategoryDivIcon(iconKey, color, size);
}

// ── Unique key for a cluster feature (used for diff) ─────────────────

function featureKey(f: ClusterFeature): string {
  return f.type === 'cluster' ? `c_${f.id}` : `p_${f.id}`;
}

// ── POI Layer component ──────────────────────────────────────────────

interface POILayerProps {
  visible?: boolean;
  activeFilter?: string | null;
  onPlaceSelect?: (poi: POI) => void;
}

export default function POILayer({
  visible = true,
  activeFilter = null,
  onPlaceSelect,
}: POILayerProps) {
  const map = useMap();

  // Store selectors (individual to avoid re-renders on unrelated state)
  const serial = usePoiStore((s) => s.serial);
  const fetchForViewport = usePoiStore((s) => s.fetchForViewport);
  const setFilter = usePoiStore((s) => s.setFilter);
  const getPOIArray = usePoiStore((s) => s.getPOIArray);

  // Marker pool: keyed by feature key → Leaflet layer
  const poolRef = useRef(new Map<string, L.Marker>());
  // Previous filter to detect changes
  const prevFilterRef = useRef<string | null>(null);
  // Track zoom level as state (only changes on zoomend, not moveend)
  const [zoomLevel, setZoomLevel] = useState(() => map.getZoom());
  // Track viewport bbox string — only used to trigger re-render for off-screen culling
  const [bboxKey, setBboxKey] = useState('');

  // ── Handle filter changes — immediate cleanup ─────────────────────

  useEffect(() => {
    if (activeFilter !== prevFilterRef.current) {
      prevFilterRef.current = activeFilter;

      // Immediately remove all old markers from the map — no animation delay
      for (const layer of poolRef.current.values()) layer.remove();
      poolRef.current.clear();

      const cats = activeFilter && FILTER_CATEGORIES[activeFilter]
        ? [FILTER_CATEGORIES[activeFilter].geoapify]
        : undefined;
      setFilter(activeFilter, cats);
    }
  }, [activeFilter, setFilter]);

  // ── Fetch tiles + update viewport state ───────────────────────────

  const triggerFetch = useCallback(() => {
    const z = map.getZoom();
    setZoomLevel(z);
    const b = map.getBounds();
    setBboxKey(`${b.getWest().toFixed(3)}_${b.getSouth().toFixed(3)}_${b.getEast().toFixed(3)}_${b.getNorth().toFixed(3)}`);

    if (!visible || z < 14) return;
    const cats = activeFilter && FILTER_CATEGORIES[activeFilter]
      ? [FILTER_CATEGORIES[activeFilter].geoapify]
      : undefined;
    fetchForViewport(b, z, cats);
  }, [map, visible, activeFilter, fetchForViewport]);

  // Debounced version — prevents rapid-fire on zoom/pan (150ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(triggerFetch, 150);
  }, [triggerFetch]);

  // Initial fetch on mount / filter change
  useEffect(() => { triggerFetch(); }, [triggerFetch]);

  // Only listen to moveend (fires on zoom too) — debounced to avoid double calls
  useMapEvents({
    moveend: () => debouncedFetch(),
  });

  // ── Render: reindex + diff-update markers ─────────────────────────

  useEffect(() => {
    // Clear everything if not visible or zoomed out
    if (!visible || zoomLevel < 14) {
      for (const layer of poolRef.current.values()) layer.remove();
      poolRef.current.clear();
      return;
    }

    const isFiltered = !!activeFilter;
    const filterColor = activeFilter ? FILTER_CHIP_COLORS[activeFilter] : undefined;
    const markerSize: 'sm' | 'lg' = isFiltered ? 'lg' : 'sm';
    const markerPx = isFiltered ? 36 : 28;

    const currentZoom = Math.floor(zoomLevel);
    // At deep zoom (≥17), show ALL POIs regardless of priority
    const showAll = isFiltered || currentZoom >= 17;

    // Reindex supercluster — only priority-eligible POIs enter the index
    diagStart('render-cycle');
    diagStart('reindex');
    const allPOIs = getPOIArray();
    reindex(allPOIs, serial, zoomLevel, showAll);
    diagEnd('reindex', { pois: allPOIs.length });

    // Query with buffer (1.3× viewport) so panning shows markers immediately
    const bounds = map.getBounds();
    const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.15;
    const lngPad = (bounds.getEast() - bounds.getWest()) * 0.15;
    const features = getVisibleFeatures(
      bounds.getWest() - lngPad,
      bounds.getSouth() - latPad,
      bounds.getEast() + lngPad,
      bounds.getNorth() + latPad,
      zoomLevel,
    );

    // ── Collision-aware label placement ──────────────────────────────
    const pointFeatures = features.filter(
      (f): f is Extract<ClusterFeature, { type: 'point' }> => f.type === 'point',
    );

    const candidates: LabelCandidate[] = [];
    for (const f of pointFeatures) {
      const priority = resolvePriority(f.poi.types || []);
      // When filtered or deep zoom, bypass priority check — show all POIs
      if (!showAll && priority > currentZoom) continue;
      const pt = map.latLngToContainerPoint([f.lat, f.lng]);
      candidates.push({
        id: f.id,
        screenX: pt.x,
        screenY: pt.y,
        name: f.poi.name,
        priority: showAll ? 0 : priority,
        markerSize: markerPx,
      });
    }

    diagStart('label-collision');
    const placements = resolveLabels(candidates, currentZoom, showAll);
    diagEnd('label-collision', { candidates: candidates.length, placed: placements.size });

    // Build new key set
    const newKeys = new Set<string>();
    for (const f of features) {
      if (f.type === 'point') {
        const priority = resolvePriority(f.poi.types || []);
        if (!showAll && priority > currentZoom) continue;
      }
      newKeys.add(featureKey(f));
    }

    // DIFF: remove markers no longer visible
    const pool = poolRef.current;
    for (const [key, layer] of pool) {
      if (!newKeys.has(key)) {
        layer.remove();
        pool.delete(key);
      }
    }

    // DIFF: add/update markers
    for (const f of features) {
      const k = featureKey(f);

      if (f.type === 'cluster') {
        if (!pool.has(k)) {
          const marker = L.marker([f.lat, f.lng], {
            icon: getClusterDivIcon(f.count, filterColor),
            bubblingMouseEvents: false,
          }).addTo(map);
          marker.on('click', () => {
            map.flyTo([f.lat, f.lng], f.expansionZoom, { duration: 0.4 });
          });
          pool.set(k, marker);
        }
        continue;
      }

      // Point feature — check priority
      const priority = resolvePriority(f.poi.types || []);
      if (!isFiltered && priority > currentZoom) continue;

      const placement = placements.get(f.id);
      const existing = pool.get(k);

      if (existing) {
        // Update label: bind/unbind/reposition based on collision result
        if (placement?.show) {
          const tt = existing.getTooltip();
          if (!tt) {
            existing.bindTooltip(placement.displayName, {
              permanent: true,
              direction: placement.direction,
              offset: placement.offset,
              className: 'poi-label-tooltip poi-label-fadein',
            });
          }
        } else if (existing.getTooltip()) {
          existing.unbindTooltip();
        }
        continue;
      }

      // New marker
      const marker = L.marker([f.lat, f.lng], {
        icon: getPoiIcon(f.poi, markerSize),
        bubblingMouseEvents: false,
      }).addTo(map);

      const hasLabel = !!placement?.show;
      if (hasLabel) {
        marker.bindTooltip(placement.displayName, {
          permanent: true,
          direction: placement.direction,
          offset: placement.offset,
          className: 'poi-label-tooltip poi-label-fadein',
        });
      }

      // Hover: bring marker + label to front
      const hoverName = f.poi.name.length > 20 ? f.poi.name.slice(0, 20) + '…' : f.poi.name;
      marker.on('mouseover', () => {
        marker.setZIndexOffset(9000);
        const el = (marker as any)._icon as HTMLElement | undefined;
        if (el) el.classList.add('poi-marker-hover');
        if (!hasLabel) {
          marker.bindTooltip(hoverName, {
            permanent: true, direction: 'top', offset: [0, -markerPx / 2 - 2],
            className: 'poi-label-tooltip poi-label-fadein',
          });
          (marker as any)._hoverTooltip = true;
        }
      });
      marker.on('mouseout', () => {
        marker.setZIndexOffset(0);
        const el = (marker as any)._icon as HTMLElement | undefined;
        if (el) el.classList.remove('poi-marker-hover');
        if ((marker as any)._hoverTooltip) {
          marker.unbindTooltip();
          (marker as any)._hoverTooltip = false;
        }
      });

      const poi = f.poi;
      marker.on('click', () => { onPlaceSelect?.(poi); });
      pool.set(k, marker);
    }
    diagEnd('render-cycle', { markers: pool.size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial, visible, zoomLevel, bboxKey, activeFilter]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      for (const layer of poolRef.current.values()) layer.remove();
      poolRef.current.clear();
    };
  }, []);

  return null;
}
