import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { fieldBase, type FieldRegion } from '../../lib/field/source';
import { schoolList, searchSchools, type SchoolEntry } from '../../lib/route/schools';
import type { SchoolFile } from '../../lib/route/schoolZone';
import type { RouteDest } from './WalkRouteLayer';

/**
 * "Ke sekolah" (task F1-12): search the region's schools by name (OpenStreetMap, on the device) and make one the
 * destination; the next tap on the map is the start.
 */
export default function SchoolPicker({ region, value, onChange }: { region: FieldRegion; value: RouteDest | null; onChange: (d: RouteDest | null) => void }) {
  // the loaded list remembers which region it belongs to, so a region switch shows "loading" without a reset in the effect
  const key = `${region.geometry}/${region.name}`;
  const [loaded, setLoaded] = useState<{ key: string; list: SchoolEntry[] | null; failed: boolean } | null>(null);
  const [q, setQ] = useState('');
  const list = loaded?.key === key ? loaded.list : null;
  const failed = loaded?.key === key && loaded.failed;

  useEffect(() => {
    let alive = true;
    // revalidate every time (ETag, a 304 when unchanged): the file is cached for a day and gained names in v2
    fetch(`${fieldBase()}/graphs/${key}_schools.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((f: SchoolFile) => alive && setLoaded({ key, list: schoolList(f), failed: false }))
      .catch(() => alive && setLoaded({ key, list: null, failed: true }));
    return () => { alive = false; };
  }, [key]);

  const hits = useMemo(() => (list ? searchSchools(list, q, 6) : []), [list, q]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-teal-50 dark:bg-teal-900/30 px-3 py-2 text-xs">
        <GraduationCap className="w-4 h-4 shrink-0 text-teal-700 dark:text-teal-300" />
        <span className="min-w-0 flex-1 truncate"><span className="text-gray-500 dark:text-gray-400">Ke sekolah:</span> <b>{value.name}</b></span>
        <button onClick={() => { onChange(null); setQ(''); }} aria-label="Hapus tujuan sekolah" className="rounded-full p-1 hover:bg-teal-100 dark:hover:bg-teal-800">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
        <GraduationCap className="w-4 h-4 shrink-0 text-teal-700 dark:text-teal-300" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ke sekolah: ketik nama sekolah (mis. SMA Negeri 1)"
          aria-label="Cari sekolah tujuan" className="min-w-0 min-h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400" />
      </label>
      {failed && <p className="text-[11px] text-amber-700">Daftar sekolah belum tersedia untuk wilayah ini.</p>}
      {q && list && hits.length === 0 && (
        <p className="text-[11px] text-gray-500">Tidak ditemukan. Daftar diambil dari OpenStreetMap; sekolah yang belum dipetakan belum muncul.</p>
      )}
      {hits.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800" role="listbox" aria-label="Sekolah">
          {hits.map((s) => (
            <li key={s.k}>
              <button role="option" aria-selected={false} onClick={() => onChange({ lat: s.lat, lng: s.lng, name: s.name })}
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800">
                {s.name} {s.kind === 'kindergarten' && <span className="text-gray-400">· TK/PAUD</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
