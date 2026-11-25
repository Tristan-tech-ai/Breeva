import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('landing at /, map at /peta (N-02, 25 Nov 2026)', () => {
  it('/ renders the root route, /landing redirects to / and the live map is /peta', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/<Route path="\/" element={<RootRoute \/>} \/>/);
    expect(app).toMatch(/<Route path="\/landing" element={<Navigate to="\/" replace \/>} \/>/);
    expect(app).toMatch(/<Route path="\/peta" element={<ExploreMapPage \/>} \/>/);
  });

  it('guests get the landing, signed-in users the app', () => {
    const r = readFileSync('src/components/auth/RootRoute.tsx', 'utf8');
    expect(r).toMatch(/if \(user\) return <Navigate to="\/home" replace \/>/);
    expect(r).toMatch(/return <LandingPage \/>/);
  });

  it('road colours are on by default in the app map, and the PWA starts at /', () => {
    expect(readFileSync('src/pages/HomePage.tsx', 'utf8')).toMatch(/useState\(true\);\r?\n/);
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/start_url: '\/'/);
  });
});
