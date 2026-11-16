/**
 * Airport visibility as a smoke trace (Koschmieder), port of the proposal's analysis F (sumber_proposal/analisis_f.py).
 *
 *   extinction b = 3.912 / V (V in km, capped at 10 km, the top of METAR reporting), dried for humidity:
 *   b_dry = b * (1 - RH)^0.6 with RH capped at 95 %; fine-particle mass PM2.5 ~ b_dry / alpha.
 *
 * The rule fires only when the hour is smoky: the airport reports smoke (FU), or more than half the reports are below
 * 10 km with no rain, drizzle, thunderstorm, mist or fog and the mean visibility is under 3 km. Otherwise visibility
 * says nothing useful about PM2.5 and the field keeps its other inputs.
 */

export interface MetarReport { station: string; valid: string; vsby_mi: number | null; relh: number | null; wxcodes: string }

export interface MetarHour {
  station: string; hour_utc: string; reports: number;
  vkm: number | null; b_dry: number | null; below_10km: number; smoke: boolean; fog: boolean; wet: boolean;
}

const MI_KM = 1.609344;

/** Aggregate the reports of one station inside one UTC hour, as analisis_f does (means of b, b_dry, cap; max of wx). */
export function summariseHour(reports: MetarReport[], station: string, hourUtc: string): MetarHour {
  const rs = reports.filter((r) => r.station === station && r.valid.slice(0, 13) === hourUtc.slice(0, 13));
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const vk: number[] = [], bd: number[] = [], cap: number[] = [];
  let smoke = false, fog = false, wet = false;
  for (const r of rs) {
    const wx = r.wxcodes || '';
    if (wx.includes('FU')) smoke = true;
    if (/BR|FG/.test(wx)) fog = true;
    if (/RA|TS|DZ|SH/.test(wx)) wet = true;
    if (r.vsby_mi == null || !Number.isFinite(r.vsby_mi)) continue;
    const v = Math.min(10, Math.max(0.05, r.vsby_mi * MI_KM));
    vk.push(v);
    cap.push(r.vsby_mi >= 6.2 ? 1 : 0);
    if (r.relh != null && Number.isFinite(r.relh)) bd.push((3.912 / v) * (1 - Math.min(r.relh, 95) / 100) ** 0.6);
  }
  const capMean = mean(cap);
  return {
    station, hour_utc: hourUtc, reports: rs.length, vkm: mean(vk), b_dry: mean(bd),
    below_10km: capMean == null ? 0 : 1 - capMean, smoke, fog, wet,
  };
}

/** alpha in m2/g (stats_f.json, about 6.2); the estimate in ug/m3, or null when the rule does not fire. */
export function koschmiederPm25(h: MetarHour, alphaM2g: number): { pm25: number; reason: 'smoke' | 'low_visibility' } | null {
  if (h.b_dry == null || h.vkm == null) return null;
  const dryLow = h.below_10km > 0.5 && !h.wet && !h.fog && h.vkm < 3;
  if (!h.smoke && !dryLow) return null;
  // b_dry is per km; alpha m2/g = 1e-3 km^-1 per ug/m3.
  return { pm25: h.b_dry / (alphaM2g / 1000), reason: h.smoke ? 'smoke' : 'low_visibility' };
}

/** Parse the comma output of the IEM ASOS service (format=onlycomma, missing=M). */
export function parseIemCsv(text: string): MetarReport[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  const at = (k: string) => head.indexOf(k);
  const iS = at('station'), iV = at('valid'), iVs = at('vsby'), iR = at('relh'), iW = at('wxcodes');
  const num = (s: string | undefined) => (s == null || s === 'M' || s === '' ? null : Number(s));
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    const wx = c[iW] ?? '';
    return { station: c[iS], valid: (c[iV] ?? '').replace(' ', 'T'), vsby_mi: num(c[iVs]), relh: num(c[iR]), wxcodes: wx === 'M' ? '' : wx };
  });
}
