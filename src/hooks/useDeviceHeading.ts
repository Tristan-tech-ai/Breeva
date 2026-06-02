import { useEffect, useRef, useState } from 'react';

// Live compass heading from the device orientation sensor: degrees 0–360 where
// 0 = North and the value points where the TOP of the phone faces (clockwise).
// Returns null until a reading arrives or if the sensor/permission is unavailable
// — callers should fall back to a movement-derived heading in that case.
//
// iOS 13+ requires a one-time permission requested from a user gesture; call
// `requestDeviceHeadingPermission()` from the "Start walk" tap before relying on this.
export function useDeviceHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const rafRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onOrient = (e: DeviceOrientationEvent) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
        // iOS: webkitCompassHeading is already a true compass heading (clockwise from N).
        h = ev.webkitCompassHeading;
      } else if (typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
        // Android / absolute orientation: alpha is degrees counter-clockwise from N.
        h = 360 - ev.alpha;
      }
      if (h == null) return;
      pendingRef.current = ((h % 360) + 360) % 360;
    };

    // Throttle to ~12 Hz and de-jitter with a circular EMA so the puck glides.
    const tick = () => {
      const now = performance.now();
      if (pendingRef.current != null && now - lastEmitRef.current > 80) {
        lastEmitRef.current = now;
        const next = pendingRef.current;
        setHeading((prev) => {
          if (prev == null) return next;
          const diff = ((next - prev + 540) % 360) - 180; // shortest signed delta
          return (prev + diff * 0.4 + 360) % 360;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    // Prefer the absolute (true-north) event where the browser exposes it.
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evName, onOrient as EventListener, true);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener(evName, onOrient as EventListener, true);
      cancelAnimationFrame(rafRef.current);
      pendingRef.current = null;
    };
  }, [enabled]);

  return heading;
}

// iOS 13+ gates DeviceOrientation behind a permission prompt that MUST be invoked
// from a user gesture. Safe no-op everywhere else.
export async function requestDeviceHeadingPermission(): Promise<void> {
  try {
    const DOE = (typeof window !== 'undefined'
      ? (window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> })
      : undefined);
    if (DOE && typeof DOE.requestPermission === 'function') {
      await DOE.requestPermission();
    }
  } catch {
    /* permission denied / unsupported — caller falls back to movement heading */
  }
}
