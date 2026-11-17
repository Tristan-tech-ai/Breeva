/**
 * localStorage that never throws (task F4-11). With site data blocked, a full quota or some private windows, every
 * read or write can throw; the app must still start and the map, routes and trial pages must still work, only without
 * remembering anything.
 */
export interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function safeStorage(get: () => Storage): SafeStorage {
  return {
    getItem: (k) => { try { return get().getItem(k); } catch { return null; } },
    setItem: (k, v) => { try { get().setItem(k, v); } catch { /* not saved */ } },
    removeItem: (k) => { try { get().removeItem(k); } catch { /* nothing to remove */ } },
  };
}

export const safeLocalStorage = safeStorage(() => localStorage);
