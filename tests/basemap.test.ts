import { describe, expect, it } from 'vitest';
import { basemap } from '../src/lib/basemap';

describe('basemap', () => {
  it('uses OpenStreetMap with attribution when there is no CARTO key (no watermarked tiles)', () => {
    const b = basemap('voyager', false, '');
    expect(b.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(b.attribution).toMatch(/OpenStreetMap/);
    expect(b.url).not.toMatch(/cartocdn/);
  });

  it('darkens OSM tiles with a CSS class in dark mode', () => {
    expect(basemap('voyager', true, '').className).toBe('basemap-dark');
  });

  it('uses CARTO with the key when one is configured', () => {
    const b = basemap('voyager', false, 'k 1');
    expect(b.url).toContain('basemaps.cartocdn.com/rastertiles/voyager/');
    expect(b.url).toContain('?key=k%201');
    expect(b.attribution).toMatch(/CARTO/);
    expect(basemap('voyager', true, 'k').url).toContain('/dark_all/');
  });

  it('keeps Esri imagery for satellite, with its attribution', () => {
    expect(basemap('satellite', false, '').attribution).toMatch(/Esri/);
  });
});
