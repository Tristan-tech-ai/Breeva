import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StatCard from '../src/components/viz/StatCard';
import BarChart from '../src/components/viz/BarChart';
import LineChart, { linePath } from '../src/components/viz/LineChart';
import ScatterChart from '../src/components/viz/ScatterChart';
import Sparkline from '../src/components/viz/Sparkline';
import Rincian from '../src/components/viz/Rincian';
import SourceLine from '../src/components/viz/SourceLine';

describe('viz components (N-01)', () => {
  it('stat card shows the number, unit and note', () => {
    const html = renderToStaticMarkup(h(StatCard, { label: 'Sensor aktif', value: 23, unit: 'sensor', note: 'jam ini' }));
    expect(html).toContain('Sensor aktif');
    expect(html).toContain('>23<');
    expect(html).toContain('jam ini');
  });

  it('bars scale to the largest value and carry an accessible name', () => {
    const html = renderToStaticMarkup(h(BarChart, { title: 'Asap kendaraan', bars: [{ label: 'A', value: 50 }, { label: 'B', value: 25 }], unit: 'µg/m³' }));
    expect(html).toContain('aria-label="Asap kendaraan"');
    expect(html).toContain('data-pct="100.0"');
    expect(html).toContain('data-pct="50.0"');
    expect(html).toContain('25 µg/m³');
  });

  it('bars clamp to the given scale end', () => {
    const html = renderToStaticMarkup(h(BarChart, { title: 't', max: 10, bars: [{ label: 'x', value: 30 }, { label: 'y', value: -1 }] }));
    expect(html).toContain('data-pct="100.0"');
    expect(html).toContain('data-pct="0.0"');
  });

  it('line path breaks at missing values and draws one segment per run', () => {
    const d = linePath([1, 2, null, 4, 5], 0, 5);
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect((d.match(/L/g) ?? []).length).toBe(2);
  });

  it('line chart draws each series and the reference line', () => {
    const html = renderToStaticMarkup(h(LineChart, { title: 'PM2,5 24 jam', series: [{ name: 'Gang', values: [1, 2, 3] }, { name: 'Jalan besar', values: [3, 2, 1] }], reference: { value: 15, label: 'WHO' } }));
    expect(html).toContain('data-series="Gang"');
    expect(html).toContain('data-series="Jalan besar"');
    expect(html).toContain('WHO');
    expect(html).toContain('role="img"');
  });

  it('scatter draws one dot per point and the 1:1 line', () => {
    const html = renderToStaticMarkup(h(ScatterChart, { title: 'Tebakan lawan ukuran', xLabel: 'ukur', yLabel: 'tebak', points: [{ x: 10, y: 12 }, { x: 20, y: 18 }, { x: 30, y: 33 }] }));
    expect((html.match(/<circle/g) ?? []).length).toBe(3);
    expect(html).toContain('stroke-dasharray="3 3"');
  });

  it('sparkline needs two points and marks the last one', () => {
    expect(renderToStaticMarkup(h(Sparkline, { values: [1], label: 'x' }))).toBe('');
    const html = renderToStaticMarkup(h(Sparkline, { values: [1, null, 3, 2], label: 'Asap 24 jam' }));
    expect(html).toContain('aria-label="Asap 24 jam"');
    expect((html.match(/<circle/g) ?? []).length).toBe(1);
  });

  it('rincian folds its content under a summary, closed by default', () => {
    const html = renderToStaticMarkup(h(Rincian, { summary: 'Cara menghitung' }, 'teks panjang'));
    expect(html).toContain('<details');
    expect(html).not.toContain(' open=""');
    expect(html).toContain('Cara menghitung');
    expect(html).toContain('teks panjang');
  });

  it('source line names its source', () => {
    expect(renderToStaticMarkup(h(SourceLine, null, 'OpenAQ'))).toContain('Sumber: OpenAQ');
  });
});
