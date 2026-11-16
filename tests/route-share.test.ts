import { describe, expect, it } from 'vitest';
import { parseRouteLink, routeLink } from '../src/lib/route/share';

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
