import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// F1-50: the installed app says what Breeva 3 is, in Indonesian, and the offline banner is readable and in Indonesian.
describe('installed app (F1-50)', () => {
  it('manifest name, language and description match the site', () => {
    const v = readFileSync('vite.config.ts', 'utf8');
    expect(v).toMatch(/name: 'Breeva — Asap Kendaraan per Ruas Jalan'/);
    expect(v).toMatch(/lang: 'id'/);
    expect(v).not.toMatch(/Eco Walking Rewards|real-time/);
  });
  it('offline banner in Indonesian on a dark enough red', () => {
    const b = readFileSync('src/components/ui/OfflineBanner.tsx', 'utf8');
    expect(b).toMatch(/Tanpa internet: wilayah yang sudah disimpan tetap berwarna/);
    expect(b).not.toMatch(/You're offline|bg-danger-500/);
  });
});
