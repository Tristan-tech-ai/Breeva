import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('map first at /', () => {
  it('/ renders the root route, and the landing page moved to /landing', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/<Route path="\/" element={<RootRoute \/>} \/>/);
    expect(app).toMatch(/<Route path="\/landing" element={<LandingPage \/>} \/>/);
  });

  it('guests get the live map, signed-in users the app', () => {
    const r = readFileSync('src/components/auth/RootRoute.tsx', 'utf8');
    expect(r).toMatch(/if \(user\) return <Navigate to="\/home" replace \/>/);
    expect(r).toMatch(/return <ExploreMapPage \/>/);
  });

  it('road colours are on by default in the app map, and the PWA starts at /', () => {
    expect(readFileSync('src/pages/HomePage.tsx', 'utf8')).toMatch(/useState\(true\);\r?\n/);
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/start_url: '\/'/);
  });
});
