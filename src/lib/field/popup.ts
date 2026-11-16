/** Popup of one road of the static field: value, ISPU, interval, traffic part, harga hirup, freshness. No Leaflet here. */
import { ispuRounded, pm25Category } from '../ispu';
import type { CellValue } from './cells';
import { HARGA_LABELS } from './harga';
import { ageLabel, type FieldSource } from './source';

type PopupSource = Pick<FieldSource, 'ageHours' | 'isStale' | 'manifest' | 'harga'>;

export function hargaLine(src: PopupSource, c: number, i: number): string {
  const h = src.harga?.value(c, i);
  if (h == null || !src.harga) return '';
  return `<div style="font-size:11px;color:#444">harga hirup ${h.toFixed(2)}× median wilayah (${HARGA_LABELS[src.harga.klass(h)]})</div>`;
}

export function popupHtml(v: CellValue | undefined, name: string | undefined, src: PopupSource, c: number, i: number): string {
  const age = ageLabel(src.ageHours());
  const stale = src.isStale() ? ' · <b style="color:#b45309">data lama</b>' : '';
  if (!v) return `<div style="font-size:12px">Nilai ruas ini sedang dimuat.</div>`;
  const band = pm25Category(v.pm25);
  const index = ispuRounded('pm25', v.pm25) ?? 0;
  const lo = Math.max(0, v.pm25 - v.pi_half), hi = v.pm25 + v.pi_half;
  const title = name ? `<div style="font-weight:600;font-size:12px;color:#111;margin-bottom:3px">${name.replace(/</g, '&lt;')}</div>` : '';
  return `<div style="min-width:180px">${title}` +
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">` +
    `<span style="width:9px;height:9px;border-radius:50%;background:${band.color};display:inline-block;box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>` +
    `<span style="font-weight:700;font-size:13px;color:#111">PM2.5 ${v.pm25.toFixed(1)} µg/m³</span></div>` +
    `<div style="font-size:11px;color:#444">ISPU ${index} · ${band.name} · rentang 95%: ${lo.toFixed(0)}–${hi.toFixed(0)} µg/m³</div>` +
    `<div style="font-size:11px;color:#444">dari lalu lintas ruas sekitar: PM2.5 +${v.pm25_delta.toFixed(2)} · NO₂ +${v.no2_delta.toFixed(1)} µg/m³ (NO₂ total ${v.no2.toFixed(0)})</div>` +
    hargaLine(src, c, i) +
    (v.ood ? `<div style="font-size:11px;color:#6b7280">di luar wilayah terkalibrasi</div>` : '') +
    (src.manifest?.indicative ? `<div style="font-size:11px;color:#b45309">Indikatif: belum ada stasiun ukur di wilayah ini</div>` : '') +
    `<div style="font-size:10px;color:#6b7280;margin-top:3px">dihitung ${age}${stale}</div></div>`;
}
