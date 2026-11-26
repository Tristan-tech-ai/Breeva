import { useEffect, useState } from 'react';
import { formatAngka } from '../../lib/angka';
import { tanggalId } from '../../lib/tanggalId';

interface KotaPola { kamera: number; dipakai: number; rho_median: number | null; rho_kuartil: [number, number] | null; bagian_rho_0_5: number | null }
interface PolaJam { periode_wib: [string, string]; putaran: number; catatan: string; kota: Record<string, KotaPola> }

const NAMA: Record<string, string> = { kota_bandung: 'Kota Bandung', kota_bogor: 'Kota Bogor', kota_yogyakarta: 'Kota Yogyakarta' };

/**
 * M-C01: does the model's hourly traffic curve follow what the public cameras count? Rank correlation of each camera's
 * 24-hour profile with the model curve, per city (public/data/validasi_pola_jam.json). A traffic-pattern check only,
 * not a concentration accuracy, and not used in the map numbers.
 */
export default function PolaJamKamera() {
  const [d, setD] = useState<PolaJam | null>(null);
  useEffect(() => {
    let batal = false;
    fetch('/data/validasi_pola_jam.json').then((r) => (r.ok ? r.json() : null)).then((x: PolaJam | null) => { if (!batal) setD(x); }).catch(() => { if (!batal) setD(null); });
    return () => { batal = true; };
  }, []);
  if (!d) return null;
  const kota = Object.entries(d.kota).filter(([, k]) => k.dipakai > 0);
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm" data-pola-jam>
      <h2 className="font-bold">Pola jam lalu lintas: kamera lawan model</h2>
      <p className="mt-1 text-gray-700 dark:text-gray-300">
        Kamera lalu lintas publik dihitung tiap 20 menit (uji coba selama lomba, gambar tidak disimpan). Untuk tiap kamera, urutan jam ramai
        dan sepi dalam sehari dibandingkan dengan kurva jam di model (korelasi peringkat, 1 = urutannya sama persis). Ini menguji pola jam
        lalu lintas, bukan ketepatan angka polusi, dan tidak dipakai untuk angka peta.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-[13px]">
          <caption className="sr-only">Korelasi pola jam kamera dengan model per kota</caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th scope="col" className="py-1 pr-2">Kota</th>
              <th scope="col" className="py-1 pr-2">Kamera dipakai</th>
              <th scope="col" className="py-1 pr-2">Korelasi median (kuartil)</th>
              <th scope="col" className="py-1">Korelasi 0,5 atau lebih</th>
            </tr>
          </thead>
          <tbody>
            {kota.map(([id, k]) => (
              <tr key={id} className="border-b border-gray-100 dark:border-gray-800">
                <th scope="row" className="py-1 pr-2 font-semibold">{NAMA[id] ?? id}</th>
                <td className="py-1 pr-2 tabular-nums">{k.dipakai} dari {k.kamera}</td>
                <td className="py-1 pr-2 tabular-nums">
                  {k.rho_median == null ? '-' : formatAngka(k.rho_median, 2, 2)}
                  {k.rho_kuartil && ` (${formatAngka(k.rho_kuartil[0], 2, 2)} sampai ${formatAngka(k.rho_kuartil[1], 2, 2)})`}
                </td>
                <td className="py-1 tabular-nums">{k.bagian_rho_0_5 == null ? '-' : `${formatAngka(100 * k.bagian_rho_0_5, 0, 0)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-gray-700 dark:text-gray-300">
        Data {d.putaran} putaran, {tanggalId(d.periode_wib[0])} sampai {tanggalId(d.periode_wib[1])} WIB (satu hari kerja). Malam hari gambar gelap bisa menghitung
        terlalu sedikit kendaraan.
      </p>
    </section>
  );
}
