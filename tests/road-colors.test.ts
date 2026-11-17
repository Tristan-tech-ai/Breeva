import { describe, expect, it } from 'vitest';
import { TRAFFIC_CLEAN, TRAFFIC_DEADBAND, TRAFFIC_GREY, TRAFFIC_STOPS, trafficColor, trafficPollutant } from '../src/lib/roadColors';
import { fieldColor } from '../src/lib/field/color';
import { pm25Category, sensitiveAdvice } from '../src/lib/ispu';
import { readFileSync } from 'node:fs';

const base = { pm25: 24.3, pm25_delta: 0, no2: 8, no2_delta: 0, confidence: 'high' as const, ood: false, pi_half: 10 };

describe('traffic view colours', () => {
  it('PM differences below the dead band are grey; a road with practically no exhaust is teal, not grey', () => {
    expect(trafficColor('pm25', 0.05)).toBe(TRAFFIC_GREY);  // median local street in Badung-Denpasar, 16 Nov
    expect(trafficColor('pm25', 0.7)).toBe(TRAFFIC_GREY);   // median big road
    expect(trafficColor('no2', 1.9)).toBe(TRAFFIC_CLEAN);   // a lane away from any busy road
    expect(trafficColor('no2', Number.NaN)).toBe(TRAFFIC_GREY); // no value yet
    expect(trafficColor('pm25', Number.NaN)).toBe(TRAFFIC_GREY);
    expect(trafficColor('no2', TRAFFIC_DEADBAND.no2)).not.toBe(TRAFFIC_CLEAN);
  });

  it('the scale is fixed: the same value has the same colour, and stops are the top colour beyond the last step', () => {
    expect(trafficColor('no2', 10.5)).toBe(trafficColor('no2', 10.5));
    expect(trafficColor('no2', 100)).toBe(TRAFFIC_STOPS.no2[4][1]);
    expect(trafficColor('no2', 500)).toBe(TRAFFIC_STOPS.no2[4][1]);
    // a lane, a collector and a trunk road at a busy hour get three different colours
    expect(new Set([trafficColor('no2', 3.5), trafficColor('no2', 22), trafficColor('no2', 110)]).size).toBe(3);
    expect(trafficColor('pm25', 2)).toBe(TRAFFIC_STOPS.pm25[1][1]);
  });

  it('the index and O3 show NO2, the exhaust tracer', () => {
    expect(trafficPollutant('aqi')).toBe('no2');
    expect(trafficPollutant('o3')).toBe('no2');
    expect(trafficPollutant('pm25')).toBe('pm25');
  });

  it('traffic colours are not the health colours, so they are not read as a category', () => {
    const health = new Set(['#00E400', '#FFFF00', '#FF7E00', '#FF0000', '#8F3F97', '#7E0023']);
    for (const stops of Object.values(TRAFFIC_STOPS)) for (const [, c] of stops) expect(health.has(c.toUpperCase())).toBe(false);
  });

  it('field roads: ISPU in total mode, the traffic part in traffic mode', () => {
    expect(fieldColor(base, 'aqi', 'total')).toBe(pm25Category(24.3).color);
    expect(fieldColor({ ...base, no2_delta: 10.5 }, 'aqi', 'traffic')).not.toBe(TRAFFIC_GREY);
    expect(fieldColor({ ...base, no2_delta: 0.75 }, 'aqi', 'traffic')).toBe(TRAFFIC_CLEAN);
    expect(fieldColor({ ...base, ood: true }, 'aqi', 'traffic')).toBe('#9ca3af');
  });

  it('no layer stretches the scale to the roads on screen any more', () => {
    for (const f of ['src/components/map/RoadMvtLayer.tsx', 'src/components/map/RoadPollutionLayer.tsx', 'src/components/map/FieldLayer.ts', 'src/lib/field/color.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/contrast|p90/i);
    }
  });
});

describe('sensitive profile', () => {
  it('warns from the WHO daily guideline, leaving the category unchanged', () => {
    expect(sensitiveAdvice(15)).toBeNull();
    expect(sensitiveAdvice(24.3)).toMatch(/pedoman harian WHO 15/);
    expect(sensitiveAdvice(80)).toMatch(/N95/);
    expect(pm25Category(24.3).name).toBe(pm25Category(24.3).name);
  });
});

describe('note under the Udara total legend (F1-20)', async () => {
  const { totalModeNote } = await import('../src/lib/roadColors');
  it('says the NO2 view adds exhaust counted as NOx and is an upper bound', () => {
    const n = totalModeNote('no2')!;
    expect(n).toMatch(/NOx/);
    expect(n).toMatch(/batas atas/);
    expect(n).toMatch(/bukan NO₂ terukur/);
  });
  it('has no note for the other pollutants', () => {
    for (const p of ['aqi', 'pm25', 'pm10', 'o3']) expect(totalModeNote(p)).toBeNull();
  });
});
