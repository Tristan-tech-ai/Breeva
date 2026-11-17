import { describe, expect, it } from 'vitest';
import { installStorageShim, memoryStorage } from '../src/lib/storageShim';

const working = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('storage shim (F1-36)', () => {
  it('leaves working storage alone', () => {
    const ls = working(), ss = working();
    const w: Record<string, unknown> = { localStorage: ls, sessionStorage: ss };
    expect(installStorageShim(w)).toEqual([]);
    expect(w.localStorage).toBe(ls);
  });

  it('replaces storage whose access throws (site data blocked) with memory storage', () => {
    const w: Record<string, unknown> = {};
    Object.defineProperty(w, 'localStorage', { get: () => { throw new Error('SecurityError'); }, configurable: true });
    Object.defineProperty(w, 'sessionStorage', { get: () => { throw new Error('SecurityError'); }, configurable: true });
    expect(installStorageShim(w)).toEqual(['localStorage', 'sessionStorage']);
    const s = w.localStorage as Storage;
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
    expect(s.length).toBe(1);
  });

  it('replaces storage whose writes throw (quota, some private windows)', () => {
    const w: Record<string, unknown> = { localStorage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} }, sessionStorage: working() };
    expect(installStorageShim(w)).toEqual(['localStorage']);
    expect(() => (w.localStorage as Storage).setItem('x', 'y')).not.toThrow();
  });

  it('memory storage behaves like Storage', () => {
    const s = memoryStorage();
    s.setItem('k', 'v'); s.setItem('j', 'w');
    expect(s.key(0)).toBe('k');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
    s.clear();
    expect(s.length).toBe(0);
  });

  it('outside a browser there is nothing to replace', () => {
    expect(installStorageShim({})).toEqual([]);
  });
});
