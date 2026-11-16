/** Field regions the hourly builder computes: pack name, engine region, local time zone, indicative flag. */
export interface BuildRegion { name: string; region: string; tz: number; indicative: boolean; geometry: string }

export const BUILD_REGIONS: BuildRegion[] = [
  { name: 'badung_denpasar', region: 'bali', tz: 8, indicative: false, geometry: '2026-11' },
  // No measuring station inside Kota Bogor: background of the Jabodetabek calibration, values marked indicative.
  { name: 'kota_bogor', region: 'jakarta', tz: 7, indicative: true, geometry: '2026-11' },
];

/** S3 key of a region's road pack (uploaded once per geometry version). */
export const packKey = (r: BuildRegion) => `packs/${r.geometry}/${r.name}.bin`;
