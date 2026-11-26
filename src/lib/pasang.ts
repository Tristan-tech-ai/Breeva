/** The install offer waits this long after the app started, so a first look (or a demo recording) is not covered by it. */
export const TUNDA_PASANG_MS = 60_000;

/** Whether the install banner may show: an install offer exists, not dismissed, not on /developers, and late enough. */
export function bolehTampil(adaTawaran: boolean, ditolak: boolean, pathname: string, sejakMulaiMs: number): boolean {
  return adaTawaran && !ditolak && pathname !== '/developers' && sejakMulaiMs >= TUNDA_PASANG_MS;
}
