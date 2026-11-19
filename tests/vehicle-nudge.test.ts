import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVehicleNudgeDismissed, VEHICLE_NUDGE_DISMISS_KEY } from '../src/lib/vehicleNudge';

// X-M1: the "jangan tampilkan lagi" check moved out of the modal component (react-refresh/only-export-components);
// it must keep the same key, so a choice saved before the move still holds.
function stubStorage(getItem: (k: string) => string | null) {
  vi.stubGlobal('localStorage', { getItem, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 });
}

afterEach(() => vi.unstubAllGlobals());

describe('vehicle nudge dismissal', () => {
  it('keeps the key the modal has always written', () => {
    expect(VEHICLE_NUDGE_DISMISS_KEY).toBe('breeva_vehicle_nudge_dismissed');
  });

  it('is dismissed only when the key holds "1"', () => {
    const store: Record<string, string> = {};
    stubStorage((k) => store[k] ?? null);
    expect(isVehicleNudgeDismissed()).toBe(false);
    store[VEHICLE_NUDGE_DISMISS_KEY] = '1';
    expect(isVehicleNudgeDismissed()).toBe(true);
    store[VEHICLE_NUDGE_DISMISS_KEY] = '0';
    expect(isVehicleNudgeDismissed()).toBe(false);
  });

  it('treats unavailable storage as not dismissed', () => {
    stubStorage(() => { throw new Error('blocked'); });
    expect(isVehicleNudgeDismissed()).toBe(false);
  });
});
