import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// In-memory localStorage for the persisted stores (node has none).
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const realFetch = globalThis.fetch;
const fetchSpy = vi.fn(() => Promise.reject(new Error('network not allowed in this test')));

beforeAll(() => {
  vi.stubGlobal('localStorage', storage);
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});
afterAll(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

describe('guest mode store', () => {
  it('enter, record a walk, leave: local only, mirrored into the auth profile', async () => {
    const { useGuestStore, isGuest } = await import('../src/stores/guestStore');
    const { useAuthStore } = await import('../src/stores/authStore');
    expect(isGuest()).toBe(false);

    useAuthStore.getState().enterGuest();
    expect(isGuest()).toBe(true);
    expect(useAuthStore.getState().profile).toMatchObject({ full_name: 'Tamu', ecopoints_balance: 0, total_walks: 0 });
    expect(useAuthStore.getState().isInitialized).toBe(true);

    const r = useGuestStore.getState().completeWalk({
      id: 'w1', started_at: new Date().toISOString(), distance_meters: 1500, duration_seconds: 1100, avg_aqi: 60,
    });
    expect(r.ok && r.walk.ecopoints_earned).toBe(19); // 15 + ROUND(3.75)
    expect(useAuthStore.getState().profile).toMatchObject({ ecopoints_balance: 19, total_walks: 1, total_distance_km: 1.5, current_streak: 1 });
    expect(JSON.parse(mem.get('breeva-guest')!).state).toMatchObject({ active: true, walks: [{ id: 'w1', ecopoints_earned: 19 }] });

    useAuthStore.getState().leaveGuest();
    expect(isGuest()).toBe(false);
    expect(useAuthStore.getState().profile).toBeNull();
    // the local records stay on the device for the next guest session
    expect(useGuestStore.getState().walks).toHaveLength(1);
  });

  it('no request reaches the account server in guest mode, even from an unguarded call', async () => {
    const { useGuestStore } = await import('../src/stores/guestStore');
    const { supabase } = await import('../src/lib/supabase');
    useGuestStore.getState().enter();
    fetchSpy.mockClear();
    const { error } = await supabase.from('users').select('*').eq('id', 'x');
    expect(error?.message).toMatch(/Guest mode/);
    const rpc = await supabase.rpc('claim_daily_bonus', { p_user_id: 'x' });
    expect(rpc.error?.message).toMatch(/Guest mode/);
    expect(fetchSpy).not.toHaveBeenCalled();
    useGuestStore.getState().exit();
  });
});
