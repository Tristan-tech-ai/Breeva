import { HARGA_COLORS, HARGA_LABELS } from '../../lib/field/harga';

/** Legend of the harga hirup view: five fixed classes of the region's roads and what the index means. */
export default function HargaLegend() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {HARGA_COLORS.map((c, k) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-full" style={{ background: c }} />
            <span className="text-[10.5px] text-gray-600 dark:text-gray-300">{HARGA_LABELS[k]}</span>
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500 dark:text-gray-400">
        Harga hirup: seberapa banyak orang yang menghirup gas buang kendaraan di ruas ini, dari kepadatan bangunan di
        sekitarnya dan sekolah serta fasilitas kesehatan dalam 500 m, dengan model sebaran. Tiap warna = seperlima ruas
        wilayah. Ini bukan kualitas udara di ruas itu; dipakai untuk rute kendaraan dan prioritas penanganan.
      </p>
    </div>
  );
}
