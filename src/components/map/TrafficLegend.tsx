import { TRAFFIC_DEADBAND, TRAFFIC_GREY, TRAFFIC_STOPS, trafficPollutant } from '../../lib/roadColors';

const NAME: Record<'pm25' | 'no2' | 'pm10', string> = { pm25: 'PM2.5', no2: 'NO₂', pm10: 'PM10' };

/** Legend of the traffic view: fixed ug/m3 steps, grey dead band, and what the colours do and do not mean. */
export default function TrafficLegend({ pollutant }: { pollutant: string }) {
  const p = trafficPollutant(pollutant);
  const stops = TRAFFIC_STOPS[p];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-full" style={{ background: TRAFFIC_GREY }} />
          <span className="text-[10.5px] text-gray-600 dark:text-gray-300">&lt; {TRAFFIC_DEADBAND[p]}</span>
        </span>
        {stops.map(([v, c]) => (
          <span key={v} className="flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-full" style={{ background: c }} />
            <span className="text-[10.5px] text-gray-600 dark:text-gray-300">{v}+</span>
          </span>
        ))}
        <span className="text-[10.5px] text-gray-500 dark:text-gray-400">µg/m³ {NAME[p]}</span>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500 dark:text-gray-400">
        Bagian {NAME[p]} yang datang dari lalu lintas ruas sekitar (model dispersi). Skalanya tetap, tidak ikut
        layar; abu-abu = selisih terlalu kecil untuk dibedakan. Ini perbandingan antar-jalan, bukan tingkat bahaya:
        untuk itu pakai mode ISPU.
      </p>
    </div>
  );
}
