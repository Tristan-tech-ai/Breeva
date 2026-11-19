/** "Jangan tampilkan lagi" for the no-carbon nudge shown when a motorised mode is picked (kept apart from the modal component). */
export const VEHICLE_NUDGE_DISMISS_KEY = 'breeva_vehicle_nudge_dismissed';

/** Whether the user has chosen "jangan tampilkan lagi" for the no-carbon nudge. */
export function isVehicleNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(VEHICLE_NUDGE_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
