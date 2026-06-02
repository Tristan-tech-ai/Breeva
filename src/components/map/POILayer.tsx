import { useEffect, useRef, useCallback, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useNavigate } from 'react-router-dom';
import type { POI } from '../../lib/poi-api';
import { usePoiStore } from '../../stores/poiStore';
import { reindex, getVisibleFeatures } from '../../lib/poi-cluster';
import { resolvePriority, merchantPriority, isGreenSpace, getMerchantDivIcon } from '../../lib/poi-icons';
import { resolveLabels, type LabelCandidate } from '../../lib/label-collision';
import { diagStart, diagEnd } from '../../lib/poi-diagnostics';
import { POICanvasLayer, type ComputeResult } from './POICanvasLayer';

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

// ── POI Layer component ──────────────────────────────────────────────
// Controller (renders nothing). Non-merchant POIs are drawn on a single canvas
// (POICanvasLayer) for smooth mobile pan; merchants stay as DOM markers so their
// sponsor pill badges + tier glow are preserved exactly. The fetch half (tile
// loading) is unchanged from the DOM-marker era.

interface POILayerProps {
  visible?: boolean;
  activeFilter?: string | null;
  onPlaceSelect?: (poi: POI) => void;
  showMerchants?: boolean;
  highlightGreen?: boolean;
  // When true (Places off but Ruang Hijau on): render ONLY green-space POIs.
  greenOnly?: boolean;
  // id of the POI whose detail sheet is open → draws a highlight ring on the canvas
  selectedPoiId?: string | null;
  isDark?: boolean;
}

export default function POILayer({
  visible = true,
  activeFilter = null,
  onPlaceSelect,
  showMerchants = true,
  highlightGreen = false,
  greenOnly = false,
  selectedPoiId = null,
  isDark = false,
}: POILayerProps) {
  const map = useMap();
  const navigate = useNavigate();

  // Store selectors (individual to avoid re-renders on unrelated state)
  const serial = usePoiStore((s) => s.serial);
  const fetchForViewport = usePoiStore((s) => s.fetchForViewport);
  const setFilter = usePoiStore((s) => s.setFilter);

  // Canvas layer (non-merchant POIs) + DOM marker pool (merchants only)
  const layerRef = useRef<POICanvasLayer | null>(null);
  const merchantPoolRef = useRef(new Map<string, L.Marker>());
  // Latest context for the (long-lived) compute closure + merchant diff
  const ctxRef = useRef({ visible, activeFilter, showMerchants, highlightGreen, greenOnly });
  // Keep callbacks fresh without recreating the layer
  const onPlaceSelectRef = useRef(onPlaceSelect);
  onPlaceSelectRef.current = onPlaceSelect;
  // Previous filter to detect changes
  const prevFilterRef = useRef<string | null>(activeFilter);
  // Integer zoom — only updated on zoomend (drives merchant visibility gating)
  const [zoomLevel, setZoomLevel] = useState(() => Math.floor(map.getZoom()));

  // ── Feature computation (called by the canvas layer on view-end) ──
  // Reindex non-merchant POIs + query visible clusters/points + resolve labels.
  // Returns null when nothing should render. Reads the store + ctxRef live (no
  // stale closure) so it can be set on the layer once and reused.
  const computeFeatures = useCallback((bounds: L.LatLngBounds, zoom: number): ComputeResult | null => {
    const st = usePoiStore.getState();
    const ctx = ctxRef.current;
    if (!ctx.visible || zoom < 14) return null;

    let pois = st.getPOIArray().filter((p) => !(p as POI & { _isMerchant?: boolean })._isMerchant);
    if (ctx.greenOnly) pois = pois.filter((p) => isGreenSpace(p.types || []));

    const currentZoom = Math.floor(zoom);
    const showAll = !!ctx.activeFilter || currentZoom >= 17;

    diagStart('reindex');
    reindex(pois, st.serial, zoom, showAll, true, ctx.greenOnly);
    diagEnd('reindex', { pois: pois.length });

    const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.15;
    const lngPad = (bounds.getEast() - bounds.getWest()) * 0.15;
    const features = getVisibleFeatures(
      bounds.getWest() - lngPad,
      bounds.getSouth() - latPad,
      bounds.getEast() + lngPad,
      bounds.getNorth() + latPad,
      zoom,
    );

    // Collision-aware label placement (screen space)
    const markerPx = ctx.activeFilter ? 36 : 28;
    const candidates: LabelCandidate[] = [];
    for (const f of features) {
      if (f.type !== 'point') continue;
      const priority = resolvePriority(f.poi.types || []);
      candidates.push({
        id: f.id,
        screenX: 0, screenY: 0, // filled below
        name: f.poi.name,
        priority: showAll ? 0 : priority,
        markerSize: markerPx,
      });
      const pt = map.latLngToContainerPoint([f.lat, f.lng]);
      candidates[candidates.length - 1].screenX = pt.x;
      candidates[candidates.length - 1].screenY = pt.y;
    }
    diagStart('label-collision');
    const placements = resolveLabels(candidates, currentZoom, showAll);
    diagEnd('label-collision', { candidates: candidates.length, placed: placements.size });

    return {
      features,
      placements,
      filtered: !!ctx.activeFilter,
      highlightGreen: ctx.highlightGreen,
      clusterColor: ctx.activeFilter ? FILTER_CHIP_COLORS[ctx.activeFilter] : undefined,
    };
  }, [map]);

  // ── Merchant DOM markers (few; preserve sponsor pill badges + glow) ──
  const renderMerchants = useCallback(() => {
    const st = usePoiStore.getState();
    const ctx = ctxRef.current;
    const pool = merchantPoolRef.current;
    const currentZoom = Math.floor(map.getZoom());
    const want = ctx.visible && !ctx.greenOnly && ctx.showMerchants && currentZoom >= 14;

    const desired = new Map<string, POI>();
    if (want) {
      for (const p of st.getPOIArray()) {
        const mp = p as POI & { _isMerchant?: boolean; _priorityBoost?: number };
        if (!mp._isMerchant) continue;
        // Honor tier min-zoom (featured always; premium early; etc.) unless filtered.
        if (!ctx.activeFilter && merchantPriority(mp._priorityBoost || 0) > currentZoom) continue;
        desired.set(p.id, p);
      }
    }
    // Remove gone
    for (const [id, m] of pool) {
      if (!desired.has(id)) { m.remove(); pool.delete(id); }
    }
    // Add new
    for (const [id, poi] of desired) {
      if (pool.has(id)) continue;
      const mp = poi as POI & { _sponsorTier?: string };
      const marker = L.marker([poi.coordinate.lat, poi.coordinate.lng], {
        icon: getMerchantDivIcon(mp._sponsorTier || 'free', poi.name),
        bubblingMouseEvents: false,
        zIndexOffset: 5000,
      }).addTo(map);
      marker.on('click', () => {
        const m2 = poi as POI & { _merchantId?: string; _isDemo?: boolean };
        if (m2._merchantId && !m2._isDemo) navigate(`/merchants/${m2._merchantId}`);
        else onPlaceSelectRef.current?.(poi);
      });
      pool.set(id, marker);
    }
  }, [map, navigate]);

  // ── Create the canvas layer once ──────────────────────────────────
  useEffect(() => {
    const layer = new POICanvasLayer();
    layer.onPointTap = (poi) => onPlaceSelectRef.current?.(poi);
    layer.onClusterTap = (lat, lng, ez) => map.flyTo([lat, lng], ez, { duration: 0.4 });
    layer.setCompute(computeFeatures);
    layer.setStyleContext({ dark: isDark });
    layer.attach(map);
    layerRef.current = layer;
    return () => {
      layer.detach();
      layerRef.current = null;
      const pool = merchantPoolRef.current;
      for (const m of pool.values()) m.remove();
      pool.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // ── Fetch tiles ───────────────────────────────────────────────────
  const triggerFetch = useCallback(() => {
    const z = map.getZoom();
    if (!visible || z < 14) return;
    const cats = activeFilter && FILTER_CATEGORIES[activeFilter]
      ? [FILTER_CATEGORIES[activeFilter].geoapify]
      : undefined;
    fetchForViewport(map.getBounds(), z, cats);
  }, [map, visible, activeFilter, fetchForViewport]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(triggerFetch, 300);
  }, [triggerFetch]);

  // Initial fetch on mount / filter change
  useEffect(() => { triggerFetch(); }, [triggerFetch]);

  // moveend fires on pan AND zoom; zoomend updates the integer zoom for merchant gating.
  useMapEvents({
    moveend: () => debouncedFetch(),
    zoomend: () => setZoomLevel(Math.floor(map.getZoom())),
  });

  // ── Filter change → clear canvas + merchants, then refetch ────────
  useEffect(() => {
    if (activeFilter !== prevFilterRef.current) {
      prevFilterRef.current = activeFilter;
      layerRef.current?.clear();
      const pool = merchantPoolRef.current;
      for (const m of pool.values()) m.remove();
      pool.clear();
      const cats = activeFilter && FILTER_CATEGORIES[activeFilter]
        ? [FILTER_CATEGORIES[activeFilter].geoapify]
        : undefined;
      setFilter(activeFilter, cats);
    }
  }, [activeFilter, setFilter]);

  // ── Data / context changed → refresh canvas + reconcile merchants ──
  useEffect(() => {
    ctxRef.current = { visible, activeFilter, showMerchants, highlightGreen, greenOnly };
    const layer = layerRef.current;
    if (layer) {
      if (!visible || zoomLevel < 14) layer.clear();
      else layer.refresh();
    }
    renderMerchants();
  }, [serial, zoomLevel, visible, activeFilter, showMerchants, highlightGreen, greenOnly, renderMerchants]);

  // ── Selected POI → highlight ring (ring-only redraw) ──────────────
  useEffect(() => {
    layerRef.current?.setSelected(selectedPoiId ?? null);
  }, [selectedPoiId]);

  // ── Dark mode → restyle labels ────────────────────────────────────
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyleContext({ dark: isDark });
    layer.refresh();
  }, [isDark]);

  return null;
}
