/**
 * VAYU Engine — Circuit Breaker
 * Prevents cascading failures when external services are down.
 * ERD Section 13.1, 13.2, 13.3
 */

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerState {
  state: CircuitState;
  failCount: number;
  lastFailAt: number;
}

// In-memory store (per Vercel function instance — ephemeral, but sufficient for burst protection)
const breakers = new Map<string, CircuitBreakerState>();

const MAX_FAILS = 3;
const COOLDOWN_MS = 300_000; // 5 minutes

function getBreaker(service: string): CircuitBreakerState {
  if (!breakers.has(service)) {
    breakers.set(service, { state: 'closed', failCount: 0, lastFailAt: 0 });
  }
  return breakers.get(service)!;
}

/** Check if circuit allows request */
export function canRequest(service: string): boolean {
  const b = getBreaker(service);
  if (b.state === 'closed') return true;
  if (b.state === 'open') {
    // Check cooldown for half-open transition
    if (Date.now() - b.lastFailAt > COOLDOWN_MS) {
      b.state = 'half-open';
      return true;
    }
    return false;
  }
  // half-open: allow one probe request
  return true;
}

/** Record a successful request */
export function recordSuccess(service: string): void {
  const b = getBreaker(service);
  b.state = 'closed';
  b.failCount = 0;
}

/** Record a failed request */
export function recordFailure(service: string): void {
  const b = getBreaker(service);
  b.failCount++;
  b.lastFailAt = Date.now();
  if (b.failCount >= MAX_FAILS) {
    b.state = 'open';
  }
}

/** Wrap an async function with circuit breaker protection */
export async function withCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<{ data: T; degraded: boolean }> {
  if (!canRequest(service)) {
    return { data: fallback, degraded: true };
  }
  try {
    const data = await fn();
    recordSuccess(service);
    return { data, degraded: false };
  } catch {
    recordFailure(service);
    return { data: fallback, degraded: true };
  }
}

export type Freshness = 'live' | 'recent' | 'stale' | 'fallback';

/** Determine freshness label based on computed timestamp */
export function getFreshness(computedAt: Date): Freshness {
  const ageMin = (Date.now() - computedAt.getTime()) / 60_000;
  if (ageMin < 15) return 'live';
  if (ageMin < 60) return 'recent';
  if (ageMin < 360) return 'stale';
  return 'fallback';
}
