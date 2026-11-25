/** N-02: the three live numbers of the landing page, read from the same public files the map and /status read. */
export interface BerandaAngka {
  /** citizen sensors used in the latest run, summed over the regions */
  sensor: number | null;
  /** fire points over Indonesia in the last 24 hours (NASA FIRMS) */
  titikApi: number | null;
  /** hours published in the last 24 per region: the lowest of the regions */
  jamTerbit: number | null;
}

interface ManifestLite { sensors_used?: number }
interface RunsLite { runs?: Array<{ run: string; ok: boolean }> }
interface FireLite { n?: number }

/** Runs of the last 24 hours that published (run ids are YYYYMMDDHH in UTC). */
export function publishedLast24(runs: RunsLite | null, now: Date): number | null {
  if (!runs?.runs?.length) return null;
  // the 24 run hours before the current hour (the current hour's run may not exist yet, it is built at :20)
  const from = Math.floor(now.getTime() / 3_600_000) * 3_600_000 - 24 * 3_600_000;
  const t = (r: string) => Date.UTC(+r.slice(0, 4), +r.slice(4, 6) - 1, +r.slice(6, 8), +r.slice(8, 10));
  return Math.min(24, runs.runs.filter((r) => r.ok && t(r.run) >= from && t(r.run) <= now.getTime()).length);
}

export function berandaAngka(manifests: (ManifestLite | null)[], runs: (RunsLite | null)[], fire: FireLite | null, now: Date): BerandaAngka {
  const s = manifests.map((m) => m?.sensors_used).filter((v): v is number => typeof v === 'number');
  const jam = runs.map((r) => publishedLast24(r, now)).filter((v): v is number => v != null);
  return {
    sensor: s.length ? s.reduce((a, b) => a + b, 0) : null,
    titikApi: typeof fire?.n === 'number' ? fire.n : null,
    jamTerbit: jam.length ? Math.min(...jam) : null,
  };
}
