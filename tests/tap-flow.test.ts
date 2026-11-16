import { describe, expect, it } from 'vitest';
import { chooseDest, onTap, type TapState } from '../src/lib/route/tapFlow';

const A = { lat: -8.66, lng: 115.21 }, B = { lat: -8.67, lng: 115.22 }, C = { lat: -8.65, lng: 115.2 };
const school = { lat: -8.68, lng: 115.23, name: 'SMA Negeri 1 Denpasar' };

describe('tap flow of on-device routing', () => {
  it('without a school: first tap start, second destination, third a new start', () => {
    let s: TapState = { start: null, fixed: null };
    let r = onTap(s, A); s = r.state;
    expect(r).toMatchObject({ compute: null, prompt: 'Ketuk tujuan.' });
    r = onTap(s, B); s = r.state;
    expect(r.compute).toEqual({ from: A, to: B });
    r = onTap(s, C);
    expect(r.compute).toBeNull();
    expect(r.state.start).toEqual(C);
  });

  it('choosing a school makes it the destination of every next tap', () => {
    const c = chooseDest(school);
    expect(c.prompt).toBe('Tujuan: SMA Negeri 1 Denpasar. Ketuk titik berangkat di peta (rumah, kos, atau halte).');
    let s = c.state;
    let r = onTap(s, A); s = r.state;
    expect(r.compute).toEqual({ from: A, to: { lat: school.lat, lng: school.lng } });
    r = onTap(s, B);
    expect(r.compute).toEqual({ from: B, to: { lat: school.lat, lng: school.lng } });
  });

  it('choosing or clearing a school forgets a half-set start', () => {
    const half = onTap({ start: null, fixed: null }, A).state;
    expect(half.start).toEqual(A);
    expect(chooseDest(school).state).toEqual({ start: null, fixed: school });
    const cleared = chooseDest(null);
    expect(cleared.state).toEqual({ start: null, fixed: null });
    expect(cleared.prompt).toBe('Ketuk titik berangkat di peta.');
  });
});
