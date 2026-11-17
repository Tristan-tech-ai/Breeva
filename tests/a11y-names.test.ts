import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AQICard from '../src/components/features/AQICard';
import HomeStatCards from '../src/components/features/HomeStatCards';
import SearchBar from '../src/components/map/SearchBar';
import type { AirQualityData } from '../src/types';

// F1-42: axe-core 4.14.0 on breeva.site found these; the fixes keep the visible text inside each control's name
// (WCAG 2.5.3 Label in Name), give icon buttons a name, and point aria-controls only at a list that exists.
const air: AirQualityData = {
  aqi: 60, level: 'moderate', pm25: 28, pm10: 40, o3: 30, no2: 20, co: 300, so2: null,
  timestamp: new Date().toISOString(), location: { lat: -8.67, lng: 115.21 },
} as AirQualityData;

const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];

describe('accessible names (F1-42)', () => {
  it('home stat cards: no aria-label replacing the visible number and word, a hidden hint after them', () => {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(HomeStatCards)));
    const links = tags(html, 'a');
    expect(links.length).toBe(3);
    for (const a of links) expect(a).not.toMatch(/aria-label=/);
    expect(html).toMatch(/>Misi<\/span><span class="sr-only">selesai\. Buka misi\.<\/span>/);
    expect(html).toMatch(/>Hari beruntun<\/span><span class="sr-only">Buka profil\.<\/span>/);
    expect(html).toMatch(/<span class="sr-only">Buka papan peringkat\.<\/span>/);
  });

  it('AQI card: the glance row is the disclosure button, named by its visible text', () => {
    const html = renderToStaticMarkup(h(AQICard, { data: air }));
    const buttons = tags(html, 'div').filter((d) => /role="button"/.test(d));
    expect(buttons.length).toBe(1);
    expect(buttons[0]).toMatch(/aria-expanded="false"/);
    expect(buttons[0]).not.toMatch(/aria-label=/);
    expect(html).not.toMatch(/role="img" aria-label="ISPU/);
    expect(html).toMatch(/<span class="sr-only">Ketuk untuk detail\.<\/span>/);
  });

  it('search bar: aria-controls only while the result list exists, and the filter icon has a name', () => {
    const html = renderToStaticMarkup(h(SearchBar, {
      filterChips: [{ key: 'all', label: 'Semua', color: '#000', icon: null }] as never,
      activeFilter: 'all', onFilterChange: () => {},
    } as never));
    expect(html).not.toMatch(/aria-controls="search-results-list"/);
    expect(html).not.toMatch(/aria-owns="search-results-list"/);
    expect(html).toMatch(/<button[^>]*aria-label="Saring tempat: Semua"/);
  });
});

describe('touch targets at 320 px (F1-45)', () => {
  // the trial pages read window while rendering, so their link classes are checked in the source
  const src = (f: string) => readFileSync(f, 'utf8');
  it('standalone links on the trial pages and the search fields are at least 24 px tall (WCAG 2.2 2.5.8)', () => {
    expect(src('src/pages/UjiCobaPage.tsx')).toMatch(/<Link to=\{s\.link\.to\} className="mt-1 inline-block min-h-6 py-0\.5 /);
    expect(src('src/pages/UjiCobaRekapPage.tsx')).toMatch(/<Link to="\/uji-coba" className="inline-block min-h-6 py-0\.5 /);
    expect(src('src/components/map/SchoolPicker.tsx')).toMatch(/aria-label="Cari sekolah tujuan" className="min-w-0 min-h-6 /);
    const map = src('src/pages/ExploreMapPage.tsx');
    expect((map.match(/className="inline-flex min-h-6 items-center hover:text-primary-500"/g) ?? []).length).toBe(5); // footer links
    expect(map).not.toMatch(/text-\[11px\] text-gray-400 dark/);
    const search = renderToStaticMarkup(h(SearchBar, { filterChips: [], activeFilter: 'all', onFilterChange: () => {} } as never));
    expect(search).toMatch(/<input[^>]*id="search-input"[^>]*class="[^"]*self-stretch/);
  });
});
