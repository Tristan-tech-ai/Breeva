import { describe, expect, it } from 'vitest';
import { safeStorage } from '../src/lib/safeStorage';

describe('storage that never throws (F4-11)', () => {
  it('reads, writes and removes when storage works', () => {
    const m = new Map<string, string>();
    const s = safeStorage(() => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }) as unknown as Storage);
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
    s.removeItem('a');
    expect(s.getItem('a')).toBeNull();
  });
  it('blocked storage (the getter itself throws, as with site data blocked): no exception, nothing remembered', () => {
    const s = safeStorage(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(() => s.setItem('a', '1')).not.toThrow();
    expect(s.getItem('a')).toBeNull();
    expect(() => s.removeItem('a')).not.toThrow();
  });
  it('writes that throw (quota): reads still work', () => {
    const s = safeStorage(() => ({ getItem: () => 'x', setItem: () => { throw new DOMException('full', 'QuotaExceededError'); }, removeItem: () => {} }) as unknown as Storage);
    expect(() => s.setItem('a', '1')).not.toThrow();
    expect(s.getItem('a')).toBe('x');
  });
});
