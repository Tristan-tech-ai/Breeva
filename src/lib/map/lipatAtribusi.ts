import L from 'leaflet';
import { TUNDA_LIPAT_MS } from './atribusiAturan';

/**
 * M-U05 / T1-17: the attribution box covered a quarter of a phone map. OSMF Attribution Guidelines 1.5.2 (read 26 Nov 2026):
 * it must be visible when the map opens and may then collapse after five seconds or on the first map interaction, as long
 * as an "(i)" button brings it back. This adds that button and the timer; CSS class atribusi-lipat hides the box.
 */
export function lipatAtribusi(map: L.Map, tunda = TUNDA_LIPAT_MS): () => void {
  const wadah = map.getContainer();
  let tombol: HTMLButtonElement | null = null;
  const set = (lipat: boolean) => {
    wadah.classList.toggle('atribusi-lipat', lipat);
    if (tombol) { tombol.setAttribute('aria-expanded', String(!lipat)); tombol.textContent = lipat ? 'i' : '×'; }
  };
  const ctl = new L.Control({ position: 'bottomright' });
  ctl.onAdd = () => {
    const b = L.DomUtil.create('button', 'atribusi-tombol') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-label', 'Sumber data dan lisensi peta');
    L.DomEvent.disableClickPropagation(b);
    b.addEventListener('click', () => set(!wadah.classList.contains('atribusi-lipat')));
    tombol = b;
    return b;
  };
  ctl.addTo(map);
  set(false);
  let selesai = false;
  const lipatSekali = () => { if (selesai) return; selesai = true; set(true); hapusPendengar(); };
  const t = window.setTimeout(lipatSekali, tunda);
  const ev = ['pointerdown', 'wheel', 'touchstart'] as const;
  const dari = (e: Event) => { if (!(e.target instanceof Node) || !tombol?.contains(e.target)) lipatSekali(); };
  ev.forEach((n) => wadah.addEventListener(n, dari, { passive: true }));
  const hapusPendengar = () => ev.forEach((n) => wadah.removeEventListener(n, dari));
  return () => { clearTimeout(t); hapusPendengar(); ctl.remove(); wadah.classList.remove('atribusi-lipat'); };
}
