import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { labelPekan, rankThisWeek, wibToday, wibWeekStart } from '../src/lib/wibWeek';
import {
  CATATAN_CONTOH_MERCHANT, deskripsiPencapaian, desimalId, kategoriMerchant, merchantPercobaan, namaPencapaian, teksTransaksi,
} from '../src/lib/teksId';
import { ispuRingkas, ispuRounded } from '../src/lib/ispu';

const wib = (iso: string) => Date.parse(`${iso}+07:00`);

describe('N-57 WIB week and the home rank', () => {
  it('starts the week on the WIB Monday, also across the UTC date line', () => {
    expect(wibWeekStart(wib('2026-11-26T09:00:00'))).toBe('2026-11-23'); // Thursday
    expect(wibWeekStart(wib('2026-11-23T00:30:00'))).toBe('2026-11-23'); // Monday 00.30 WIB = Sunday in UTC
    expect(wibWeekStart(wib('2026-11-29T23:59:00'))).toBe('2026-11-23'); // Sunday night
    expect(wibWeekStart(wib('2026-11-30T00:00:00'))).toBe('2026-11-30');
    expect(wibWeekStart(wib('2027-01-01T08:00:00'))).toBe('2026-12-28');
    expect(wibToday(wib('2026-11-27T00:10:00'))).toBe('2026-11-27');
  });

  it('a rank from an older week is not "this week" (June #7 showed as minggu ini)', () => {
    const now = wib('2026-11-26T09:00:00');
    expect(rankThisWeek({ rank: 7, week_start: '2026-06-01' }, now)).toBeNull();
    expect(rankThisWeek({ rank: 7, week_start: '2026-11-23' }, now)).toBe(7);
    expect(rankThisWeek({ rank: 0, week_start: '2026-11-23' }, now)).toBeNull();
    expect(rankThisWeek(null, now)).toBeNull();
  });

  it('names the week the leaderboard shows', () => {
    const now = wib('2026-11-26T09:00:00');
    expect(labelPekan('2026-11-23', now)).toBe('pekan ini');
    expect(labelPekan('2026-06-15', now)).toBe('pekan 15–21 Jun 2026');
    expect(labelPekan('2026-06-29', now)).toBe('pekan 29 Jun–5 Jul 2026');
    expect(labelPekan('2025-12-29', now)).toBe('pekan 29 Des 2025–4 Jan 2026');
    expect(labelPekan(null, now)).toBe('pekan ini');
  });
});

describe('N-57 Indonesian text for rows stored in English', () => {
  it('translates the seeded achievements and keeps unknown ones', () => {
    for (const n of ['First Walk', 'Week Warrior', 'Month Master', 'Point Collector', 'Point Master', 'Eco Champion', 'Carbon Crusher', '5K Club', '10K Master', 'Marathon Hero']) {
      expect(namaPencapaian(n)).not.toBe(n === '5K Club' ? '' : n);
      expect(deskripsiPencapaian(n, 'english')).not.toMatch(/\b(walk|maintain|earn|save)\b/i);
    }
    expect(namaPencapaian('Jalan Pagi')).toBe('Jalan Pagi');
    expect(deskripsiPencapaian('Jalan Pagi', 'Jalan sebelum 07.00')).toBe('Jalan sebelum 07.00');
  });

  it('translates merchant categories, including the stored "Café"', () => {
    expect(kategoriMerchant('Café')).toBe('Kafe');
    expect(kategoriMerchant('Café'.normalize('NFD'))).toBe('Kafe');
    expect(kategoriMerchant('Refill Station')).toBe('Isi ulang');
    expect(kategoriMerchant('All')).toBe('Semua');
    expect(kategoriMerchant(null)).toBe('Umum');
    expect(kategoriMerchant('Toko Kelontong')).toBe('Toko Kelontong');
  });

  it('translates the stored transaction descriptions and keeps Indonesian ones', () => {
    expect(teksTransaksi('Welcome Bonus For Completing Onboarding', 'onboarding')).toBe('Bonus selamat datang');
    expect(teksTransaksi('welcome bonus for completing onboarding', 'onboarding')).toBe('Bonus selamat datang');
    expect(teksTransaksi('Daily login bonus: +5 pts', 'bonus')).toBe('Bonus harian');
    expect(teksTransaksi('Redeemed reward: -47 pts', 'redeemed')).toBe('Hadiah ditukar');
    expect(teksTransaksi('Earned 5 pts from walk', 'walk')).toBe('Jalan kaki');
    expect(teksTransaksi('Bonus Harian', 'bonus')).toBe('Bonus Harian');
    expect(teksTransaksi(null, 'walk_reward')).toBe('Walk reward');
  });

  it('writes quest decimals with a comma, nothing else', () => {
    expect(desimalId('Jalan kaki 1.25 km')).toBe('Jalan kaki 1,25 km');
    expect(desimalId('Tempuh 1.25 km dengan berjalan kaki hari ini.')).toBe('Tempuh 1,25 km dengan berjalan kaki hari ini.');
    expect(desimalId('Kirim 1 laporan kualitas udara.')).toBe('Kirim 1 laporan kualitas udara.');
    expect(desimalId('Versi 1.2')).toBe('Versi 1.2');
  });

  it('hides only a placeholder merchant without reviews', () => {
    expect(merchantPercobaan({ name: 'test', review_count: 0 })).toBe(true);
    expect(merchantPercobaan({ name: ' Test ', review_count: null })).toBe(true);
    expect(merchantPercobaan({ name: 'test', review_count: 3 })).toBe(false);
    expect(merchantPercobaan({ name: 'Toko Test Hijau', review_count: 0 })).toBe(false);
    expect(CATATAN_CONTOH_MERCHANT).toMatch(/data contoh/);
  });
});

describe('N-57 one air-quality scale on /home', () => {
  it('states ISPU from PM2.5 the way the card does', () => {
    const r = ispuRingkas(12.3);
    expect(r?.nilai).toBe(ispuRounded('pm25', 12.3));
    expect(r?.teks).toBe(`ISPU ${ispuRounded('pm25', 12.3)}, Baik`);
    expect(ispuRingkas(null)).toBeNull();
    expect(ispuRingkas(Number.NaN)).toBeNull();
    expect(ispuRingkas(80)?.kategori).toBe('Tidak Sehat');
  });

  it('the home live region and the navigation label no longer say US AQI', () => {
    const home = readFileSync('src/pages/HomePage.tsx', 'utf8');
    const nav = readFileSync('src/components/layout/BottomNavigation.tsx', 'utf8');
    expect(home).not.toMatch(/Kualitas udara saat ini: AQI/);
    expect(home).not.toMatch(/<AQIBadge/);
    expect(nav).not.toMatch(/kualitas udara AQI/);
    expect(nav).toMatch(/ispuRingkas/);
  });
});

function semuaBerkas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? semuaBerkas(p) : /\.(tsx?|json)$/.test(n) ? [p] : [];
  });
}

describe('N-57 inner pages, guest and signed in', () => {
  it('no page still says the account server is being restored', () => {
    const basi = semuaBerkas('src').filter((p) => /dipulihkan|sementara tidak tersedia/.test(readFileSync(p, 'utf8')));
    expect(basi).toEqual([]);
  });

  it('a guest on an account page gets a sign-in button that leaves guest mode', () => {
    const s = readFileSync('src/pages/GuestOnlyPage.tsx', 'utf8');
    expect(s).toMatch(/data-guest-masuk/);
    expect(s).toMatch(/leaveGuest\(\);\s*navigate\('\/login'\)/);
  });

  it('the English strings found on the signed-in pages are gone', () => {
    const cek: [string, string[]][] = [
      ['src/pages/RewardsPage.tsx', ['No Rewards Available Yet', 'Your Balance', 'My Vouchers', 'Search rewards', 'Tap for QR', 'Redeem EcoPoints', 'pts more']],
      ['src/pages/ProfilePage.tsx', ['Your Stats at a Glance', 'Daily Progress\n', 'Walk History', 'Point Transactions', 'Edit Profile', 'Trees equiv.', 'CO₂ Saved']],
      ['src/pages/MerchantsPage.tsx', ['Eco-Merchants', 'Discover sustainable', 'Search merchants', 'No Merchants Yet', 'No address']],
      ['src/components/features/OnboardingTour.tsx', ["'Got it!'", "'Next'"]],
    ];
    for (const [p, frasa] of cek) {
      const s = readFileSync(p, 'utf8');
      for (const f of frasa) expect(s.includes(f), `${p}: ${f}`).toBe(false);
    }
  });

  it('rewards and merchants say the seeded partners are demo data', () => {
    expect(readFileSync('src/pages/RewardsPage.tsx', 'utf8')).toMatch(/data-catatan-contoh/);
    expect(readFileSync('src/pages/MerchantsPage.tsx', 'utf8')).toMatch(/data-catatan-contoh/);
  });

  it('the home rank reads only this week and the leaderboard names its week', () => {
    expect(readFileSync('src/hooks/useHomeStats.ts', 'utf8')).toMatch(/\.eq\('week_start', wibWeekStart\(\)\)/);
    const lb = readFileSync('src/pages/LeaderboardPage.tsx', 'utf8');
    expect(lb).toMatch(/breeva_active_leaderboard_week/);
    expect(lb).toMatch(/data-pekan-tampil/);
    expect(lb).not.toMatch(/\{idx \+ 1\}/);
  });
});
