import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 (or previous value) to the target using
 * requestAnimationFrame with an ease-out cubic curve.
 */
export function useAnimatedNumber(target: number, duration = 800) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(from + (target - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = target;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}
