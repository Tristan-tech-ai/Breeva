/**
 * Imported first by main.tsx (task F1-36). When the browser refuses web storage (Chrome with all site data blocked
 * throws on the mere access to window.localStorage; a full quota or some private windows throw on every write), the
 * many places that read or write storage while the app starts would stop it from rendering at all. In that case the
 * two storages are replaced, for this page only, by storage kept in memory: the app works and simply forgets on
 * reload. Code that must not pretend something was saved (the trial diary) asks isMemoryStorage().
 */
type Name = 'localStorage' | 'sessionStorage';
const replaced = new Set<Name>();

export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

/** Replace each storage that cannot be read and written; returns the names replaced. */
export function installStorageShim(w: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Name[] {
  const out: Name[] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    let ok = false;
    try {
      const s = w[name] as Storage | undefined;
      if (!s) continue; // not a browser (tests, server rendering): nothing to protect
      s.setItem('__breeva_probe', '1');
      s.removeItem('__breeva_probe');
      ok = true;
    } catch { ok = false; }
    if (ok) continue;
    try {
      Object.defineProperty(w, name, { value: memoryStorage(), configurable: true, writable: false });
      replaced.add(name);
      out.push(name);
    } catch { /* cannot replace: the guarded call sites still work */ }
  }
  return out;
}

/** True when this page keeps the storage in memory only (nothing survives a reload). */
export function isMemoryStorage(name: Name = 'localStorage'): boolean {
  return replaced.has(name);
}

if (typeof window !== 'undefined') installStorageShim(window as unknown as Record<string, unknown>);
