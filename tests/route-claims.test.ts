import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { relabelScoredRoutes } from '../src/lib/routeLabels';
import { CO2_GRAMS_PER_KM, co2SavedGramsForMode } from '../src/lib/metrics';
import type { Route } from '../src/types';

const route = (id: string, duration: number, aqi: number, estimate: 'model' | 'rough', type: Route['route_type'] = 'balanced') =>
  ({ id, duration_seconds: duration, avg_aqi: aqi, aqi_estimate: estimate, route_type: type }) as Route;

describe('fallback route labels', () => {
  it('names the cleanest route only when every route was scored by the model', () => {
    const out = relabelScoredRoutes([route('a', 600, 80, 'model'), route('b', 700, 55, 'model'), route('c', 650, 70, 'model')]);
    expect(out.map((r) => r.route_type)).toEqual(['fast', 'eco', 'balanced']);
  });

  it('keeps the planned labels when any route is a heuristic estimate', () => {
    const input = [route('a', 600, 80, 'model', 'fast'), route('b', 700, 55, 'rough', 'eco')];
    expect(relabelScoredRoutes(input)).toBe(input);
  });

  it('the fallback path sets no invented confidence number', () => {
    const store = readFileSync('src/stores/mapStore.ts', 'utf8');
    const fallback = store.slice(store.indexOf('Legacy fallback'));
    expect(fallback).not.toMatch(/confidence = (60|85|90)/);
    expect(fallback).not.toMatch(/geminiAQIs/);
  });
});

describe('claims and constants', () => {
  it('uses one CO2 rate (metrics.ts) for the trip estimate', () => {
    expect(co2SavedGramsForMode(2, 0)).toBe(2 * CO2_GRAMS_PER_KM);
    expect(co2SavedGramsForMode(2, 170)).toBe(0);
    expect(readFileSync('src/components/map/TransportModeSelector.tsx', 'utf8')).not.toMatch(/\(170 -/);
  });

  it('the stories no longer promise "up to 60% less pollution"', () => {
    expect(readFileSync('src/components/features/InAppStories.tsx', 'utf8')).not.toMatch(/60% less pollution/);
  });
});
