import { describe, expect, it } from 'vitest';
import { DEPART_CHOICES, inSchoolHours, parseDepart } from '../src/lib/route/depart';
import { localTimeToMs, schoolActive, SCHOOL_HOURS } from '../src/lib/route/schoolZone';
import { routeLink, parseRouteLink } from '../src/lib/route/share';

describe('departure choices', () => {
  it('offers now and one time inside each school window', () => {
    expect(DEPART_CHOICES.map((c) => c.value)).toEqual([null, '06:45', '12:30']);
    expect(DEPART_CHOICES.filter((c) => c.value).every((c) => inSchoolHours(c.value))).toBe(true);
    expect(inSchoolHours(null)).toBe(false);
    expect(inSchoolHours('10:00')).toBe(false);
  });

  it('a choice activates the school zone in the region\'s local time', () => {
    const now = Date.UTC(2026, 10, 16, 12, 0); // 20.00 WITA
    for (const c of DEPART_CHOICES.filter((x) => x.value)) {
      expect(schoolActive({ tz: 8, hours: SCHOOL_HOURS }, localTimeToMs(c.value, 8, now))).toBe(true);
    }
    expect(schoolActive({ tz: 8, hours: SCHOOL_HOURS }, localTimeToMs(null, 8, now))).toBe(false);
  });

  it('parses the link value and keeps it in a copied route link', () => {
    expect(parseDepart('7.05')).toBe('07:05');
    expect(parseDepart('25:00')).toBeNull();
    const url = routeLink('https://breeva.site/peta', { from: { lat: -8.66, lng: 115.21 }, to: { lat: -8.67, lng: 115.22 }, mode: 'motor' }, '06:45');
    const q = url.slice(url.indexOf('?'));
    expect(new URLSearchParams(q).get('berangkat')).toBe('06:45');
    expect(parseRouteLink(q)?.mode).toBe('motor');
  });
});
