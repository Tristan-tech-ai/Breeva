import { describe, expect, it } from 'vitest';
import { nextStreak, validateWalk, walkCo2Grams, walkEcoPoints, walkKm } from '../src/lib/walkPoints';
import { applyGuestWalk, emptyGuestProfile, guestUserProfile } from '../src/stores/guestStore';

describe('walk points mirror complete_walk', () => {
  it('10 points per km, rounded, at least 1', () => {
    expect(walkEcoPoints(2500)).toBe(25);
    expect(walkEcoPoints(60)).toBe(1);
    expect(walkEcoPoints(40)).toBe(1); // ROUND(0.4) = 0, floor of 1
    expect(walkEcoPoints(1050)).toBe(11); // ROUND(10.5) rounds half away from zero
  });

  it('distance is rounded to whole metres, then to 0.01 km (DECIMAL(10,2)) before the points', () => {
    expect(walkKm(1004)).toBe(1);
    expect(walkKm(1005)).toBe(1.01);
    expect(walkKm(1004.6)).toBe(1.01); // 1005 m after the integer cast
    expect(walkEcoPoints(1005)).toBe(10); // ROUND(10.1)
    expect(walkEcoPoints(1949)).toBe(20); // 1.949 km is stored as 1.95, then ROUND(19.5) = 20
  });

  it('AQI bonus: +50% at AQI <= 50, +25% at AQI <= 100, none above or without AQI', () => {
    expect(walkEcoPoints(2500, 40)).toBe(38); // 25 + ROUND(12.5)
    expect(walkEcoPoints(2500, 50)).toBe(38);
    expect(walkEcoPoints(2500, 80)).toBe(31); // 25 + ROUND(6.25)
    expect(walkEcoPoints(2500, 100)).toBe(31);
    expect(walkEcoPoints(2500, 101)).toBe(25);
    expect(walkEcoPoints(2500, null)).toBe(25);
    expect(walkEcoPoints(300, 30)).toBe(5); // 3 + ROUND(1.5)
    expect(walkEcoPoints(200, 70)).toBe(3); // 2 + ROUND(0.5)
  });

  it('CO2: ROUND(km * 120) grams', () => {
    expect(walkCo2Grams(2500)).toBe(300);
    expect(walkCo2Grams(1005)).toBe(121); // 1.01 km * 120 = 121.2
    expect(walkCo2Grams(0)).toBe(0);
  });

  it('refuses the walks the server refuses', () => {
    expect(validateWalk(1000, 600).valid).toBe(true);
    expect(validateWalk(1000, 200)).toEqual({ valid: false, reason: 'Speed too high for walking' });
    expect(validateWalk(1000, 20000)).toEqual({ valid: false, reason: 'Speed too low' });
    expect(validateWalk(0, 100).valid).toBe(false);
    const jump = [
      { lat: -8.67, lng: 115.21, timestamp: '2026-11-16T01:00:00Z' },
      { lat: -8.68, lng: 115.21, timestamp: '2026-11-16T01:00:10Z' }, // 1.1 km in 10 s
    ];
    expect(validateWalk(1200, 900, jump)).toEqual({ valid: false, reason: 'Suspicious movement detected' });
  });

  it('streak follows update_user_streak', () => {
    const fresh = { current_streak: 0, longest_streak: 0, last_walk_date: null };
    expect(nextStreak(fresh, '2026-11-16')).toEqual({ current_streak: 1, longest_streak: 1 });
    const yesterday = { current_streak: 4, longest_streak: 6, last_walk_date: '2026-11-15' };
    expect(nextStreak(yesterday, '2026-11-16')).toEqual({ current_streak: 5, longest_streak: 6 });
    expect(nextStreak({ ...yesterday, last_walk_date: '2026-11-16' }, '2026-11-16')).toEqual({ current_streak: 4, longest_streak: 6 });
    expect(nextStreak({ ...yesterday, last_walk_date: '2026-11-13' }, '2026-11-16')).toEqual({ current_streak: 1, longest_streak: 6 });
    expect(nextStreak({ current_streak: 6, longest_streak: 6, last_walk_date: '2026-10-31' }, '2026-11-01')).toEqual({ current_streak: 7, longest_streak: 7 });
  });
});

describe('a guest walk updates the local profile like the server', () => {
  const start = '2026-11-16T00:30:00.000Z';
  it('adds points, XP, distance, CO2, walks and the streak', () => {
    const p0 = emptyGuestProfile(new Date('2026-11-01T00:00:00Z'));
    const r = applyGuestWalk(p0, { id: 'w1', started_at: start, distance_meters: 2500.4, duration_seconds: 1800, avg_aqi: 42 }, '2026-11-16');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.walk).toMatchObject({ id: 'w1', distance_meters: 2500, ecopoints_earned: 38, co2_saved_grams: 300, avg_aqi: 42, transport_mode: 'walking' });
    expect(r.profile).toMatchObject({
      ecopoints_balance: 38, xp: 38, total_distance_km: 2.5, total_walks: 1, total_co2_saved_grams: 300,
      current_streak: 1, longest_streak: 1, last_walk_date: '2026-11-16',
    });
    const r2 = applyGuestWalk(r.profile, { id: 'w2', started_at: start, distance_meters: 1005, duration_seconds: 700 }, '2026-11-17');
    expect(r2.ok && r2.profile).toMatchObject({ ecopoints_balance: 48, total_distance_km: 3.51, total_walks: 2, current_streak: 2 });
  });

  it('a refused walk changes nothing', () => {
    const p0 = emptyGuestProfile();
    const r = applyGuestWalk(p0, { id: 'w1', started_at: start, distance_meters: 5000, duration_seconds: 600 }, '2026-11-16');
    expect(r).toEqual({ ok: false, reason: 'Speed too high for walking' });
  });

  it('the profile the pages read: name Tamu, level and tier from XP', () => {
    const u = guestUserProfile({ ...emptyGuestProfile(), xp: 210, ecopoints_balance: 210 });
    expect(u).toMatchObject({ id: 'guest', full_name: 'Tamu', ecopoints_balance: 210, level: 3, tier: 'sprout', onboarding_completed: true });
  });
});
