import { straightRoadProfile } from '../../lib/field/exhaust';

const DISTANCES = [0, 25, 50, 100, 150];
const SOURCES: Array<{ label: string; href: string }> = [
  { label: 'Karner, Eisinger, Niemeier (2010), Environmental Science & Technology 44(14): 41 studi pinggir jalan', href: 'https://doi.org/10.1021/es100008x' },
  { label: 'US EPA, AERMOD Model Formulation (EPA-454/B-26-003), bagian 5.4: batas plume acak', href: 'https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_mfd.pdf' },
  { label: 'US EPA, ISC3 User\'s Guide vol. II (EPA-454/B-95-003b), tabel 1-4: sebaran vertikal perkotaan Briggs', href: 'https://gaftp.epa.gov/Air/aqmg/SCRAM/models/other/isc3/isc3v2.pdf' },
  { label: 'Abridged User\'s Guide for CALINE-3, bagian 5.2: zona campur di atas jalan', href: 'https://gaftp.epa.gov/Air/aqmg/SCRAM/models/other/caline3/caline3.pdf' },
];

/** What "asap kendaraan" is, how it is computed, and what has not been tested yet. The table is computed by the same kernel as the map. */
export default function ExhaustExplainer() {
  const profile = straightRoadProfile(2250, 2, 'D', 14, DISTANCES);
  const left = Math.round((profile[4] / profile[0]) * 100);
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm space-y-2.5">
      <h2 className="font-semibold">Asap kendaraan: cara hitung dan yang belum diuji</h2>
      <p>
        Angka uji di halaman ini adalah untuk <b>udara latar</b> (PM2,5), yang hampir sama di seluruh kota. <b>Asap kendaraan</b>
        {' '}(gas buang dan jelaga knalpot) dihitung terpisah, dan bagian inilah yang berbeda antara jalan ramai dan gang.
      </p>
      <p>
        Cara hitung: perkiraan jumlah kendaraan tiap ruas pada jam itu dikali emisi rata-rata armada, lalu disebarkan menurut
        jarak, kecepatan angin, dan kestabilan udara. Arah angin dirata-ratakan ke semua arah, karena arah angin di tingkat
        jalan tidak diketahui dari model cuaca. Penandanya NOx dari lalu lintas (µg/m³).
      </p>
      <div>
        <p className="text-[12px] text-gray-600 dark:text-gray-300">Contoh dari rumus yang sama dengan peta: jalan lurus 2.250 kendaraan per jam, angin 2 m/s.</p>
        <table className="mt-1 w-full text-[12px]">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400"><th className="font-medium py-1">Jarak dari jalan</th>{DISTANCES.map((d) => <th key={d} className="font-medium">{d === 0 ? 'di jalan' : `${d} m`}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td className="py-1">Asap kendaraan (µg/m³ NOx)</td>{profile.map((c, k) => <td key={DISTANCES[k]} className="tabular-nums">{c.toLocaleString('id-ID', { maximumFractionDigits: c < 10 ? 1 : 0 })}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p>
        Pembanding dari pengukuran: rangkuman 41 studi pinggir jalan menemukan gas buang seperti CO dan partikel ultrahalus turun
        paling sedikit 50% dalam 150 m dari tepi jalan, NO₂ meluruh terus sepanjang jarak, dan massa partikel (PM) tidak
        menunjukkan tren. Itu sebabnya PM2,5 hampir sama di jalan besar dan gang, sedangkan gas buang tidak.
      </p>
      <div>
        <p className="font-medium">Yang belum diuji</p>
        <ul className="list-disc pl-5 text-[13px] space-y-0.5">
          <li>Belum ada pengukuran dekat jalan di Badung–Denpasar atau Bogor yang menguji bagian ini; uji sensor tersembunyi di atas hanya menguji udara latar.</li>
          <li>Model kami turun lebih curam daripada batas hasil pengukuran itu (pada 150 m tersisa sekitar {left}% dari nilai di jalan dalam contoh di atas), jadi selisih antarjalan bisa terlalu besar.</li>
          <li>Jumlah kendaraan adalah perkiraan menurut kelas jalan dan jam, bukan hitungan kendaraan.</li>
          <li>Sisi bawah angin dan bangunan sebagai penghalang tidak dimodelkan.</li>
        </ul>
        <p className="mt-1 text-[13px]">Rencana uji: berjalan menyusuri jalan besar dan gang dengan sensor, lalu membandingkan selisihnya dengan peta.</p>
      </div>
      <ul className="text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
        {SOURCES.map((s) => <li key={s.href}><a className="underline underline-offset-2" href={s.href} target="_blank" rel="noreferrer">{s.label}</a></li>)}
      </ul>
    </section>
  );
}
