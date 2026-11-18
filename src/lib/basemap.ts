/**
 * Basemap tiles.
 *
 * CARTO raster basemaps now require a free API key outside the CARTO platform; without it every tile carries an
 * "API KEY REQUIRED" watermark (https://docs.carto.com/faqs/carto-basemaps, 16 Nov 2026). With VITE_CARTO_BASEMAP_KEY
 * set, CARTO Voyager is used with ?key=. Without it the standard OpenStreetMap tiles are used, which the OSMF tile
 * policy allows for interactive viewing with visible attribution and no prefetching or offline use
 * (https://operations.osmfoundation.org/policies/tiles/).
 *
 * The OSM standard style colours roads by class and draws its own POI icons, which clash with Breeva's coloured roads
 * and POI layer (Tristan, 18 Nov 2026), so the OSM tiles are muted with a CSS class (basemap-muted, basemap-dark).
 */

export type MapStyle = 'voyager' | 'osm' | 'satellite';

export interface Basemap { url: string; attribution: string; className?: string; subdomains?: string }

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const CARTO_ATTR = `&copy; <a href="https://carto.com/attributions">CARTO</a> ${OSM_ATTR}`;

export function basemap(style: MapStyle, dark: boolean, cartoKey = (import.meta.env.VITE_CARTO_BASEMAP_KEY as string | undefined) || ''): Basemap {
  if (style === 'satellite') {
    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    };
  }
  if (cartoKey) {
    const layer = dark ? 'dark_all' : style === 'osm' ? 'rastertiles/voyager_labels_under' : 'rastertiles/voyager';
    return {
      url: `https://{s}.basemaps.cartocdn.com/${layer}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`,
      attribution: CARTO_ATTR, subdomains: 'abcd',
    };
  }
  // OSM has no dark style and no muted style: grey out (and in dark mode invert) the standard tiles with a CSS filter.
  return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, className: dark ? 'basemap-dark' : 'basemap-muted' };
}
