import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { announceRoutes, type RouteCard } from '../src/lib/route/summary';
import WalkRouteCards from '../src/components/map/WalkRouteCards';

const card = (o: Partial<RouteCard>): RouteCard => ({
  index: 0, label: 'Tercepat', color: '#000', km: '2,84', minutes: 6, no2: 10, pm25: 25, exh: 0.9, headline: 'Rute tercepat', forecastNote: null,
  soonHint: null, harga: null, vsFastest: null, schoolNote: null, schoolCost: null, ...o,
});

describe('route announcement for screen readers (F1-47)', () => {
  it('says how many routes, then each route in one short sentence set', () => {
    const cards = [card({}), card({ index: 1, label: 'Paling sedikit asap', km: '2,95', minutes: 7, headline: 'Asap kendaraan dihirup 57% lebih sedikit dari rute tercepat',
      soonHint: 'Berangkat sekitar jam 19.00 lewat rute ini: asap kendaraan 20% lebih sedikit daripada berangkat sekarang' })];
    expect(announceRoutes(cards, 'Rute dihitung dalam 3 ms')).toBe(
      '2 rute. Tercepat: 2,84 km, 6 menit. Rute tercepat. Paling sedikit asap: 2,95 km, 7 menit. Asap kendaraan dihirup 57% lebih sedikit dari rute tercepat. '
      + 'Berangkat sekitar jam 19.00 lewat rute ini: asap kendaraan 20% lebih sedikit daripada berangkat sekarang.');
    expect(announceRoutes([card({ schoolCost: 'Zona sekolah menambah 5 menit dan 2.690 m dibanding rute tanpa zona' })], ''))
      .toBe('1 rute. Tercepat: 2,84 km, 6 menit. Rute tercepat. Zona sekolah menambah 5 menit dan 2.690 m dibanding rute tanpa zona.');
    expect(announceRoutes([], 'Menghitung rute…')).toBe('Menghitung rute…');
  });

  it('the card has one polite status line, not a live region around every button', () => {
    const html = renderToStaticMarkup(h(WalkRouteCards, { state: { status: 'Rute dihitung', cards: [card({})] } }));
    expect(html).toMatch(/<p class="sr-only" role="status">1 rute\. Tercepat: 2,84 km, 6 menit\. Rute tercepat\.<\/p>/);
    expect(html).not.toMatch(/aria-live=/);
  });
});
