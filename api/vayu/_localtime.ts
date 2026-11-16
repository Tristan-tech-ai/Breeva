/**
 * Local clock of a place in Indonesia.
 *
 * Vercel functions run with TZ reserved by the platform (https://vercel.com/docs/environment-variables/reserved-environment-variables)
 * on an AWS Lambda runtime whose clock is UTC, so `new Date().getHours()` is the UTC hour. The diurnal traffic curve and
 * the Pasquill stability class need the hour where the road is: 15:00 in Bali is 07:00 UTC.
 */

/** WIB +7, WITA +8, WIT +9, from position (Indonesia only; good enough at province level). */
export function utcOffsetHours(lat: number, lon: number): number {
  if (lon >= 127.3) return 9;                                   // Maluku, Papua
  if (lon >= 114.4) {
    if (lat > -2.5 && lat < 1.5 && lon < 115.8) return 7;      // western and central Kalimantan stay on WIB
    return 8;                                                   // Bali, Nusa Tenggara, Sulawesi, south and east Kalimantan
  }
  return 7;                                                     // Sumatra, Java, west Kalimantan
}

export interface LocalClock { hour: number; month: number; dow: number; ymd: string; offset: number }

/** Clock at (lat, lon) for `at` plus `addHours` (forecast offset). */
export function localClock(lat: number, lon: number, at: Date = new Date(), addHours = 0): LocalClock {
  const offset = utcOffsetHours(lat, lon);
  const t = new Date(at.getTime() + (addHours + offset) * 3600_000);
  return { hour: t.getUTCHours(), month: t.getUTCMonth() + 1, dow: t.getUTCDay(), ymd: t.toISOString().slice(0, 10), offset };
}
