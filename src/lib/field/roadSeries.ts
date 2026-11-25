/**
 * N-04: the exhaust of one tapped road over the next 24 hours, from what the run already published: the run hour
 * itself and its forecast hours (manifest forecast_runs: the next 3 hours and the next 07.00 and 13.00). Loaded only
 * when a road is tapped; each forecast file is decoded once per page. Drawn as a small SVG line for the popup.
 */
import { decodeExhaust, type ForecastEntry } from './forecast';

export interface SeriesPoint { ahead: number; local_hour: number; value: number }

const decoded = new Map<string, Promise<Map<number, Float32Array> | null>>();

export async function roadSeries(
  base: string, region: string, m: { run: string; valid_hour_local: number; forecast_runs?: ForecastEntry[] },
  c: number, i: number, now: number, fetchImpl: typeof fetch = (u, init) => fetch(u, init),
): Promise<SeriesPoint[]> {
  const pts: SeriesPoint[] = [{ ahead: 0, local_hour: m.valid_hour_local, value: now }];
  const entries = (m.forecast_runs ?? []).filter((e) => e.ahead >= 1 && e.ahead <= 24);
  const got = await Promise.all(entries.map(async (e) => {
    const url = `${base}/v/${region}/${m.run}/${e.key}`;
    let p = decoded.get(url);
    if (!p) {
      p = fetchImpl(url).then(async (r) => (r.ok ? decodeExhaust(new Uint8Array(await r.arrayBuffer())) : null)).catch(() => null);
      decoded.set(url, p);
    }
    const v = (await p)?.get(c)?.[i];
    return v == null || !Number.isFinite(v) ? null : { ahead: e.ahead, local_hour: e.local_hour, value: v };
  }));
  for (const g of got) if (g) pts.push(g);
  return pts.sort((a, b) => a.ahead - b.ahead);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Small line over 24 hours (x = hours ahead), dots on the hours that exist, the highest hour named. */
export function sparkSvg(pts: SeriesPoint[], w = 180, h = 44): string {
  if (pts.length < 2) return '';
  const top = Math.max(...pts.map((p) => p.value), 0.1);
  const x = (a: number) => 4 + (a / 24) * (w - 8);
  const y = (v: number) => h - 12 - (v / top) * (h - 20);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.ahead).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const hi = pts.reduce((a, b) => (b.value > a.value ? b : a));
  const lo = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const hh = (n: number) => `${String(n).padStart(2, '0')}.00`;
  const dots = pts.map((p) => `<circle cx="${x(p.ahead).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${p.ahead === 0 ? 3 : 2.2}" fill="${p.ahead === 0 ? '#0f172a' : '#b45309'}"/>`).join('');
  // a label only where it does not run into the one before (the next 3 hours sit 7 px apart on a 24-hour axis)
  let lastX = -Infinity;
  const labels = pts.map((p) => {
    const px = x(p.ahead);
    if (px - lastX < 22) return '';
    lastX = px;
    return `<text x="${px.toFixed(1)}" y="${h - 1}" font-size="8" text-anchor="${p.ahead === 0 ? 'start' : 'middle'}" fill="#6b7280">${p.ahead === 0 ? 'kini' : esc(String(p.local_hour).padStart(2, '0'))}</text>`;
  }).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Asap kendaraan jam ini dan jam berikutnya: tertinggi ${hh(hi.local_hour)}, terendah ${hh(lo.local_hour)}">` +
    `<path d="${d}" fill="none" stroke="#b45309" stroke-width="1.6" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

/** The popup block: the line and one sentence on the quietest hour among those shown. */
export function sparkBlock(pts: SeriesPoint[]): string {
  if (pts.length < 2) return '';
  const lo = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const now = pts[0].value;
  const pct = now > 0 ? Math.round((1 - lo.value / now) * 100) : 0;
  const line = lo.ahead > 0 && pct >= 10
    ? `paling sedikit asap pukul ${String(lo.local_hour).padStart(2, '0')}.00 (−${pct}% dari sekarang)`
    : 'jam ini termasuk yang paling sedikit asapnya';
  return `<div style="margin-top:4px"><div style="font-size:10px;color:#6b7280">Asap kendaraan, 24 jam ke depan (jam prakiraan yang ada)</div>${sparkSvg(pts)}` +
    `<div style="font-size:10.5px;color:#444">${line}</div></div>`;
}
