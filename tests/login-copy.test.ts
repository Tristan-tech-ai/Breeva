import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W39: the sign-in page showed '1,000+ Active Walkers', '2.5 tons CO2 Saved', '500K+ EcoPoints' with no data behind
// them, in English. Usage numbers must come from data, so none may be written into the page; the page is Indonesian.
const SRC = readFileSync('src/pages/LoginPage.tsx', 'utf8');

describe('sign-in page copy', () => {
  it('writes no usage numbers into the page (counts, tonnes, K+)', () => {
    expect(SRC).not.toMatch(/value:\s*'[^']*\d[^']*'/);
    expect(SRC).not.toMatch(/\d[\d.,]*\s*(K\+|\+|tons?|ton)\b/);
    expect(SRC).not.toMatch(/Active Walkers|CO₂ Saved|EcoPoints Shared/);
  });

  it('speaks Indonesian on the visible labels', () => {
    for (const en of ['Welcome back', 'Sign In', 'Sign Up', 'Forgot password', 'Continue with Google', 'Full Name', 'Confirm Password', 'Terms of Service', 'Privacy Policy', 'Transform your walks']) {
      expect(SRC).not.toContain(en);
    }
    for (const id of ['Selamat datang kembali', 'Masuk sebagai tamu', 'Lupa kata sandi?', 'Lanjut dengan Google', 'Kebijakan Privasi']) expect(SRC).toContain(id);
  });
});
