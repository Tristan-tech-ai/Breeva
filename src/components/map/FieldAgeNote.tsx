import { useEffect, useState } from 'react';
import { FIELD_REGIONS, fetchManifest, fieldBase } from '../../lib/field/source';
import { layerAges, type LayeredManifest } from '../../lib/field/status';

/** Two lines: how old the exhaust part and the background of the map are, from the region's manifest. */
export default function FieldAgeNote({ region, at, className = '' }: { region?: string; at?: { lat: number; lng: number } | null; className?: string }) {
  const name = region ?? FIELD_REGIONS.find((r) => at && at.lat >= r.bounds[0][0] && at.lat <= r.bounds[1][0] && at.lng >= r.bounds[0][1] && at.lng <= r.bounds[1][1])?.name;
  const [got, setGot] = useState<{ name: string; m: LayeredManifest } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!name) return;
    let alive = true;
    // the same request as the map layer and the value card (F1-54: a second request for the same file waited for the
    // first and then revalidated, 2 s on slow 3G, and the map layer got its manifest from that second one)
    fetchManifest(fieldBase(), name)
      .then((m) => { if (alive) { setGot({ name, m: m as unknown as LayeredManifest }); setNow(Date.now()); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [name]);
  const a = got && got.name === name ? layerAges(got.m, new Date(now)) : null;
  if (!a) return null;
  return (
    <div className={`text-[10.5px] leading-relaxed ${a.stale ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'} ${className}`}>
      <p>{a.exhaust}</p>
      <p>{a.background}</p>
    </div>
  );
}
