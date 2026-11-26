import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fieldBase } from '../../lib/field/source';
import type { KabTitik } from '../../lib/sensorTitik';

/** M-T05: the kab/kota that most need a first measuring point (v/nasional/butuh_sensor.json), the first `n` with a link. */
export default function ButuhSensorNasional({ n = 5 }: { n?: number }) {
  const [daftar, setDaftar] = useState<KabTitik[] | null>(null);
  useEffect(() => {
    let batal = false;
    fetch(`${fieldBase()}/v/nasional/butuh_sensor.json`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!batal) setDaftar(d?.kabkota ?? null); }).catch(() => { if (!batal) setDaftar(null); });
    return () => { batal = true; };
  }, []);
  if (!daftar?.length) return null;
  return (
    <section className="rounded-xl bg-white p-3 text-[13px] dark:bg-gray-900" aria-label="Kabupaten/kota yang paling butuh titik ukur" data-butuh-sensor>
      <p className="font-semibold">Paling butuh titik ukur pertama (indikatif)</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {daftar.slice(0, n).map((k) => <li key={k.peringkat}>{k.nama}{k.provinsi ? `, ${k.provinsi}` : ''}</li>)}
      </ol>
      <Link to="/sensor/titik" className="mt-1 inline-block font-semibold text-sky-800 underline dark:text-sky-300">Daftar 30 dan alasannya</Link>
    </section>
  );
}
