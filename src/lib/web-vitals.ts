// Core Web Vitals reporting (LCP / INP / CLS / FCP / TTFB) — lightweight (~2KB), non-blocking.
// Logs each metric to the console with its rating and stashes the latest values on
// window.__webVitals so real field numbers can be inspected/screenshotted for the pitch.
import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';

declare global {
  interface Window { __webVitals?: Record<string, { value: number; rating: string }> }
}

function report(metric: Metric) {
  const v = Math.round(metric.value * 100) / 100;
  console.info(`[web-vitals] ${metric.name}: ${v} (${metric.rating})`);
  window.__webVitals = { ...(window.__webVitals ?? {}), [metric.name]: { value: v, rating: metric.rating } };
}

export function initWebVitals() {
  try {
    onCLS(report);
    onINP(report);
    onLCP(report);
    onFCP(report);
    onTTFB(report);
  } catch {
    /* never let measurement break the app */
  }
}
