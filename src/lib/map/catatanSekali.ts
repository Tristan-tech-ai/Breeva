/**
 * A short note on the map that the user reads once and closes with "Oke" (Tristan, 27 Nov 2026: the exhaust note sat on
 * the map for good and covered it; "it is only a brief notice: give it an OK so the user reads it and it does not come
 * back"). Closing it is remembered on this device; where storage is blocked it stays closed for this page only.
 */
import L from 'leaflet';
import { sudahDibaca, tandaiDibaca } from './catatanDibaca';

/** The closed notes of this page (also when storage is blocked). */
const ditutup = new Set<string>();

/**
 * A Leaflet control holding `teks` and an "Oke" button, or an element not shown when the note was already closed. `atribut`
 * is set on the element either way (tests and the speed check read data-* attributes from it). Returns the control and
 * its element (null until the control is added to a map).
 */
export function catatanSekali(nama: string, teks: string, o: { posisi: L.ControlPosition; atribut?: string; lebar?: number }) {
  const ref: { el: HTMLElement | null } = { el: null };
  const kontrol = new L.Control({ position: o.posisi });
  kontrol.onAdd = () => {
    const d = L.DomUtil.create('div');
    ref.el = d;
    if (o.atribut) d.setAttribute(o.atribut, '');
    if (ditutup.has(nama) || sudahDibaca(nama)) { d.style.display = 'none'; return d; }
    d.setAttribute('role', 'note');
    d.style.cssText = `max-width:${o.lebar ?? 240}px;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.97);color:#1f2937;`
      + 'border-radius:12px;padding:6px 6px 6px 10px;font:500 11px/1.35 system-ui;box-shadow:0 1px 4px rgba(0,0,0,.25)';
    const p = L.DomUtil.create('span', '', d);
    p.textContent = teks;
    const b = L.DomUtil.create('button', '', d) as HTMLButtonElement;
    b.type = 'button';
    b.textContent = 'Oke';
    b.setAttribute('aria-label', 'Oke, tutup catatan ini');
    b.style.cssText = 'flex:none;min-width:44px;min-height:36px;border:0;border-radius:9999px;background:#0f766e;color:#fff;font:700 12px system-ui;cursor:pointer';
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.on(b, 'click', () => { ditutup.add(nama); tandaiDibaca(nama); d.style.display = 'none'; });
    return d;
  };
  return { kontrol, ref };
}
