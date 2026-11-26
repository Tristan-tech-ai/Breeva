import { useEffect, useRef, useState } from 'react';
import { ringkasUkur, type HasilUkur } from '../../lib/ukurHalaman';

/**
 * M-U04: in-page lag meter for /pantau?ukur=1, so Tristan can read the numbers on his own phone: frame times and long
 * tasks of the last 10 seconds (pinch the map, then read), the number of points drawn, and a button that copies the line.
 */
export default function UkurPantau() {
  const [h, setH] = useState<HasilUkur | null>(null);
  const [salin, setSalin] = useState('');
  const frames = useRef<Array<[number, number]>>([]);
  const longs = useRef<Array<[number, number]>>([]);
  useEffect(() => {
    let last = performance.now(), raf = 0;
    const tick = (t: number) => { frames.current.push([t, t - last]); last = t; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    let po: PerformanceObserver | null = null;
    try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.current.push([e.startTime, e.duration]); }); po.observe({ type: 'longtask', buffered: false }); } catch { po = null; }
    const id = window.setInterval(() => {
      const now = performance.now();
      frames.current = frames.current.filter(([t]) => now - t < 10_000);
      longs.current = longs.current.filter(([t]) => now - t < 10_000);
      setH(ringkasUkur(frames.current.map(([, d]) => d), longs.current.map(([, d]) => d), (window as unknown as { __pantauObjek?: number }).__pantauObjek ?? 0));
    }, 1000);
    return () => { cancelAnimationFrame(raf); clearInterval(id); po?.disconnect(); };
  }, []);
  if (!h) return null;
  const teks = `p95 bingkai ${h.p95} ms · tugas terpanjang ${h.tugasMaks} ms · bingkai > 100 ms: ${h.jank} · titik ${h.objek}`;
  return (
    <div className="fixed inset-x-2 bottom-2 z-[2000] rounded-xl bg-gray-900/95 px-3 py-2 text-[12px] text-white shadow-lg" role="status" data-ukur-pantau>
      <p className="tabular-nums">Ukur 10 detik terakhir: {teks}</p>
      <button type="button" className="mt-1 min-h-8 rounded-full bg-white px-3 text-[12px] font-semibold text-gray-900"
        onClick={() => { void navigator.clipboard?.writeText(`${teks} · ${navigator.userAgent}`).then(() => setSalin('Disalin'), () => setSalin('Gagal menyalin')); }}>
        {salin || 'Salin angka'}
      </button>
    </div>
  );
}
