import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { PRIVACY, STEPS, trialUrl } from '../src/lib/ujiCoba';

describe('student trial guide', () => {
  it('walks through the trial in order: map, school, start, compare, school hours, link', () => {
    expect(STEPS.map((s) => s.title)).toEqual(['Buka peta', 'Pilih sekolahmu', 'Ketuk titik berangkat', 'Bandingkan rute', 'Coba jam masuk sekolah', 'Simpan rutemu']);
    expect(STEPS[1].body).toMatch(/Ke sekolah/);
    expect(STEPS[4].body).toMatch(/06\.45/);
    expect(STEPS[5].body).toMatch(/Salin tautan rute/);
    // the start point and the privacy line promise the same thing the app does: nothing leaves the phone
    expect(STEPS[2].body).toMatch(/tidak dikirim/);
    expect(PRIVACY).toMatch(/tidak meminta nama, akun, atau lokasi rumah/);
  });

  it('uses the words the app shows today (F4-04, 17 Nov): exhaust, not NO2; the school-zone cost; the link carries the start', () => {
    const all = STEPS.map((s) => s.body).join(' ');
    expect(all).not.toMatch(/NO₂|NO2/);
    expect(STEPS[0].body).toMatch(/asap kendaraan/);
    expect(STEPS[0].body).toMatch(/Kota Bogor/);
    expect(STEPS[3].body).toMatch(/paling sedikit asap kendaraan/);
    expect(STEPS[4].body).toMatch(/zona sekolah/);
    expect(STEPS[5].body).toMatch(/memuat titik berangkatmu/);
  });

  it('the QR code encodes the guide address', async () => {
    expect(trialUrl('https://breeva.site/')).toBe('https://breeva.site/uji-coba');
    const svg = await QRCode.toString(trialUrl('https://breeva.site'), { type: 'svg' });
    expect(svg.startsWith('<svg')).toBe(true);
    const seg = QRCode.create(trialUrl('https://breeva.site'), { errorCorrectionLevel: 'M' });
    expect(seg.modules.size).toBeGreaterThanOrEqual(21);
  });
});
