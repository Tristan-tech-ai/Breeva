/** N-21: the national exhaust roads of the map: their class codes, zoom, note, and where the pilot regions take over. Pure. */
import { FIELD_REGIONS } from '../field/source';

/** Class code of the national tiles (.claude/loop/nasional/ekstrak_jalan.py: links share their road's code). Kept in this
 * light module so the map layer can style a road by its class without loading the exhaust kernel. */
export const KODE_KELAS: Record<number, string> = {
  1: 'motorway', 2: 'trunk', 3: 'primary', 4: 'secondary', 5: 'tertiary', 6: 'unclassified', 7: 'residential', 8: 'living_street', 9: 'service',
};

/** Zoom from which the phone computes exhaust per road outside the pilot regions (N-21). */
export const NATIONAL_MIN_ZOOM = 13;

/**
 * The note on the map while those roads show (M-U15, Tristan 27 Nov: "Asap kendaraan di ponsel: indikatif" told a user
 * nothing). Plain words for what it is: an estimate from the road class and the wind. Where it is computed is no concern
 * of the reader, and it changes nothing about how good the number is.
 */
export const LABEL_ASAP_NASIONAL = 'Asap kendaraan: perkiraan dari jenis jalan dan angin';

/** True when the point lies in a pilot region (those show the cloud field instead). */
export const inPilot = (lat: number, lon: number) => FIELD_REGIONS.some((r) => lat >= r.bounds[0][0] && lat <= r.bounds[1][0] && lon >= r.bounds[0][1] && lon <= r.bounds[1][1]);
