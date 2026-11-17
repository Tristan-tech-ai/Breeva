/**
 * Retry for the hourly field builder (task F2-18). Run 2026111717 lost Badung-Denpasar to one "fetch failed" while
 * Kota Bogor, built a minute later, succeeded: a passing network fault cost a whole hour of the map. Network errors,
 * 5xx and 429 are tried again after growing pauses; other answers are returned as they are. A shared budget caps the
 * total pause per invocation, so a source that is down for good fails fast instead of pushing the run past the
 * Lambda's 600 s limit. Errors name the host, so the log says which source failed.
 */
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  /** Pauses before each new try, ms (their count is the number of retries). */
  delaysMs?: number[];
  /** Total pause allowed across all calls made through this fetch, ms. */
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { host: string; attempt: number; reason: string; waitMs: number }) => void;
}

const hostOf = (input: string | URL | Request) => {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).host;
  } catch {
    return 'url?';
  }
};

export function withRetry(base: FetchFn, o: RetryOptions = {}): FetchFn & { budgetLeftMs: () => number } {
  const delays = o.delaysMs ?? [2000, 5000, 10000];
  let budget = o.budgetMs ?? 60000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const host = hostOf(input);
    for (let attempt = 0; ; attempt++) {
      let reason: string;
      try {
        const res = await base(input, init);
        if (res.status < 500 && res.status !== 429) return res;
        reason = `HTTP ${res.status}`;
        if (attempt >= delays.length || budget < delays[attempt]) return res; // out of tries: the caller sees the answer
      } catch (e) {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        reason = `${(e as Error).message}${cause?.code ? ` (${cause.code})` : cause?.message ? ` (${cause.message})` : ''}`;
        if (attempt >= delays.length || budget < delays[attempt]) throw new Error(`fetch ${host}: ${reason} after ${attempt + 1} tries`, { cause: e });
      }
      const waitMs = delays[attempt];
      budget -= waitMs;
      o.onRetry?.({ host, attempt: attempt + 1, reason, waitMs });
      await sleep(waitMs);
    }
  }) as FetchFn & { budgetLeftMs: () => number };
  f.budgetLeftMs = () => budget;
  return f;
}
