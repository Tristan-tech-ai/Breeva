import { describe, expect, it } from 'vitest';
import { parseRouteLink, parseViewLink, routeLink } from '../src/lib/route/share';

describe('view links', () => {
  it('reads ?pusat=lat,lng,zoom and defaults the zoom to 15', () => {
    expect(parseViewLink('?pusat=-6.59660,106.80470,17')).toEqual({ lat: -6.5966, lng: 106.8047, zoom: 17 });
    expect(parseViewLink('?pusat=-8.65,115.21')).toEqual({ lat: -8.65, lng: 115.21, zoom: 15 });
  });
  it('rejects malformed or out-of-range views', () => {
    expect(parseViewLink('?pusat=-6.5,106.8,25')).toBeNull();
    expect(parseViewLink('?pusat=95,106.8')).toBeNull();
    expect(parseViewLink('?pusat=abc')).toBeNull();
    expect(parseViewLink('?wilayah=kota_bogor')).toBeNull();
  });
});

describe('route links', () => {
  it('round-trips a motor route with a departure time', () => {
    const l = { from: { lat: -8.65123, lng: 115.21987 }, to: { lat: -8.68, lng: 115.17 }, mode: 'motor' as const };
    const url = routeLink('https://breeva.site/peta', l, '07:00');
    expect(url).toBe('https://breeva.site/peta?rute=-8.65123,115.21987~-8.68000,115.17000&moda=motor&berangkat=07:00');
    expect(parseRouteLink(url.slice(url.indexOf('?')))).toEqual(l);
    expect(new URLSearchParams(url.slice(url.indexOf('?'))).get('berangkat')).toBe('07:00');
  });

  it('defaults to walking and refuses malformed links', () => {
    expect(parseRouteLink('?rute=-6.6,106.8~-6.59,106.79')).toEqual({ from: { lat: -6.6, lng: 106.8 }, to: { lat: -6.59, lng: 106.79 }, mode: 'walk' });
    for (const bad of ['', '?rute=-6.6,106.8', '?rute=a,b~c,d', '?rute=-96,106~-6,106', '?rute=-6.6,106.8~-6.5,106.8~-6.4,106.8'])
      expect(parseRouteLink(bad)).toBeNull();
  });
});

describe('destination links from the priority list', () => {
  it('round-trips a school with spaces and punctuation in its name', async () => {
    const { destLink, parseDestLink } = await import('../src/lib/route/share');
    const url = destLink('/peta', { lat: -8.65512, lng: 115.21987, name: 'SMA Negeri 1 Denpasar, Bali' });
    expect(url.startsWith('/peta?sekolah=-8.65512,115.21987,')).toBe(true);
    expect(parseDestLink(url.slice(url.indexOf('?')))).toEqual({ lat: -8.65512, lng: 115.21987, name: 'SMA Negeri 1 Denpasar, Bali' });
    expect(parseDestLink('?sekolah=-8.6,115.2,')).toBeNull();
    expect(parseDestLink('?sekolah=abc')).toBeNull();
    expect(parseDestLink('')).toBeNull();
  });
});
