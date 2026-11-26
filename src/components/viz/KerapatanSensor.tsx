import { useEffect, useState } from 'react';
import { formatAngka } from '../../lib/angka';
import { tanggalId } from '../../lib/tanggalId';

interface Titik { n: number; lolos_median: number; nrmse_median: number; titik_potong_median: number; lolos_p25_p75: [number, number] }
interface Kerapatan { periode: [string, string]; sensor: number; n_untuk_4_dari_4: number | null; kurva: Titik[]; kelas: Record<string, { n: number; nrmse_median: number }> }

/**
 * M-A03: how the daily error falls as more citizen sensors are used (hidden-sensor test, Bali, 30 random draws per count)
 * and the error per location class (public/data/validasi_kerapatan.json and .png).
 */
export default function KerapatanSensor() {
  const [d, setD] = useState<Kerapatan | null>(null);
  useEffect(() => {
    let batal = false;
    fetch('/data/validasi_kerapatan.json').then((r) => (r.ok ? r.json() : null)).then((x: Kerapatan | null) => { if (!batal) setD(x); }).catch(() => { if (!batal) setD(null); });
    return () => { batal = true; };
  }, []);
  if (!d) return null;
  const akhir = d.kurva[d.kurva.length - 1];
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm" data-kerapatan>
      <h2 className="font-bold">Berapa sensor sampai lolos 4 dari 4?</h2>
      <img src="/data/validasi_kerapatan.png" width={960} height={570} loading="lazy" className="mt-2 h-auto w-full rounded bg-white"
        alt={`Galat harian turun dari ${formatAngka(d.kurva[0].nrmse_median, 1, 1)}% dengan ${d.kurva[0].n} sensor ke ${formatAngka(akhir.nrmse_median, 1, 1)}% dengan ${akhir.n} sensor; titik potong turun di bawah 5 µg/m³ mulai sekitar 20 sensor.`} />
      <p className="mt-2 text-gray-700 dark:text-gray-300">
        Dari {d.sensor} sensor warga Bali ({tanggalId(d.periode[0])} sampai {tanggalId(d.periode[1])}), sebagian dipakai dan sisanya disembunyikan lalu ditebak, 30 kali
        acak per jumlah. {d.n_untuk_4_dari_4
          ? <>Keempat target EPA harian baru lolos pada median undian dengan sekitar <b>{d.n_untuk_4_dari_4} sensor</b> (kuartil undian {akhir.lolos_p25_p75[0]} sampai {akhir.lolos_p25_p75[1]} dari 4), jadi angka ini masih berayun.</>
          : <>Keempat target EPA harian belum lolos pada median undian sampai {akhir.n} sensor.</>}
        {' '}Yang paling menahan adalah titik potong (tebakan terlalu tinggi saat udara bersih).
      </p>
      <p className="mt-1 text-[12px] text-gray-700 dark:text-gray-300">
        Galat per kelas lokasi (median NRMSE harian): {Object.entries(d.kelas).map(([k, v]) => `${k} ${formatAngka(v.nrmse_median, 1, 1)}% (${v.n} sensor)`).join('; ')}.
        Galat terbesar (kelas dataran tinggi) datang dari satu sensor yang ternyata rusak: membaca hampir 0 sejak Oktober (pemeriksaan mutu sensor 27 Nov); sensor itu akan dikeluarkan dan uji ini diulang.
      </p>
    </section>
  );
}
