import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { PRIVACY, STEPS, trialUrl } from '../src/lib/ujiCoba';

describe('student trial guide', () => {
  it('walks through the trial in order: diary, Wi-Fi first, map, school, start, compare, school hours, link', () => {
    expect(STEPS.map((s) => s.title)).toEqual(['Nyalakan catatan', 'Pertama kali, pakai Wi-Fi sekolah', 'Buka peta', 'Pilih sekolahmu', 'Ketuk titik berangkat', 'Bandingkan rute', 'Coba jam masuk sekolah', 'Simpan rutemu']);
    expect(STEPS[0].body).toMatch(/Nyalakan catatan/);
    expect(STEPS[0].body).toMatch(/Salin kode ringkasan/);
    expect(STEPS[0].body).toMatch(/tanpa lokasi/);
    expect(STEPS[3].body).toMatch(/Ke sekolah/);
    expect(STEPS[6].body).toMatch(/06\.45/);
    expect(STEPS[7].body).toMatch(/Salin tautan rute/);
    // the start point and the privacy line promise the same thing the app does: nothing leaves the phone
    expect(STEPS[4].body).toMatch(/tidak dikirim/);
    expect(PRIVACY).toMatch(/tidak meminta nama, akun, atau lokasi rumah/);
  });

  it('uses the words the app shows today (F4-04, 17 Nov): exhaust, not NO2; the school-zone cost; the link carries the start', () => {
    const all = STEPS.map((s) => s.body).join(' ');
    expect(all).not.toMatch(/NO₂|NO2/);
    expect(STEPS[2].body).toMatch(/asap kendaraan/);
    expect(STEPS[2].body).toMatch(/Kota Bogor/);
    expect(STEPS[5].body).toMatch(/paling sedikit asap kendaraan/);
    expect(STEPS[6].body).toMatch(/zona sekolah/);
    expect(STEPS[7].body).toMatch(/memuat titik berangkatmu/);
  });

  it('asks for one visit on the school Wi-Fi and a saved region before the trial (F4-16)', () => {
    expect(STEPS[1].body).toMatch(/Wi-Fi sekolah/);
    expect(STEPS[1].body).toMatch(/Simpan Badung–Denpasar untuk tanpa internet/);
    expect(STEPS[1].link?.to).toBe('/status');
    expect(STEPS[1].body).toMatch(/sekitar 19 detik/);
    expect(STEPS[1].body).toMatch(/sekitar 5 detik/); // P-54: kunjungan2_3g_f157 (rute 4,7 s)
  });

  it('the QR code encodes the guide address', async () => {
    expect(trialUrl('https://breeva.site/')).toBe('https://breeva.site/uji-coba');
    const svg = await QRCode.toString(trialUrl('https://breeva.site'), { type: 'svg' });
    expect(svg.startsWith('<svg')).toBe(true);
    const seg = QRCode.create(trialUrl('https://breeva.site'), { errorCorrectionLevel: 'M' });
    expect(seg.modules.size).toBeGreaterThanOrEqual(21);
  });
});

describe('printable sheet (F4-06)', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { PRINT_SHEET } = await import('../src/lib/ujiCoba');
  it('links a one-page PDF that exists in public/', () => {
    const path = `public${PRINT_SHEET.href}`;
    expect(existsSync(path)).toBe(true);
    const head = readFileSync(path).subarray(0, 5).toString('latin1');
    expect(head).toBe('%PDF-');
    // one A4 page (the sheet is rebuilt from STEPS; a longer step list must still fit)
    const text = readFileSync(path).toString('latin1');
    expect(text.match(/\/Count (\d+)/)?.[1]).toBe('1');
    expect(text).toMatch(/\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/);
    expect(PRINT_SHEET.label).toMatch(/lembar A4/);
  });
});
