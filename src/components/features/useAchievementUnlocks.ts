import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { showAchievementToast } from './AchievementToast';

const SEEN_KEY = 'breeva_seen_achievements';
const BASELINE_KEY = 'breeva_ach_baseline';

function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function saveSeen(s: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s])); } catch { /* quota */ }
}

/** Mark achievement ids as already-seen (so the unlock detector won't re-toast them).
 *  Call this from any path that already showed the unlock (e.g. WalkComplete). */
export function markAchievementsSeen(ids: string[]) {
  if (!ids.length) return;
  const seen = loadSeen();
  ids.forEach((id) => seen.add(id));
  saveSeen(seen);
}

/**
 * Detects achievements unlocked since the last visit (any path: walk, quest, streak,
 * another device) and fires a premium toast for each. The FIRST ever load establishes a
 * silent baseline (no toast spam for pre-existing/seeded unlocks). Returns `celebrate`
 * for the caller to render a <CelebrationBurst active={celebrate} />.
 */
export function useAchievementUnlocks() {
  const user = useAuthStore((s) => s.user);
  const [celebrate, setCelebrate] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!user || ran.current) return;
    ran.current = true;
    (async () => {
      const { data } = await supabase
        .from('user_achievements')
        .select('achievement_id, unlocked_at, achievements(name, icon, category, points_reward)')
        .eq('user_id', user.id)
        .order('unlocked_at', { ascending: true });
      if (!data) return;

      const seen = loadSeen();
      const baselineSet = localStorage.getItem(BASELINE_KEY) === '1';
      const fresh = data.filter((r) => !seen.has(r.achievement_id as string));
      data.forEach((r) => seen.add(r.achievement_id as string));
      saveSeen(seen);

      // First ever load → record baseline silently (don't toast existing unlocks).
      if (!baselineSet) { localStorage.setItem(BASELINE_KEY, '1'); return; }
      if (!fresh.length) return;

      fresh.forEach((r, i) => {
        const raw = (r as { achievements: unknown }).achievements;
        const a = (Array.isArray(raw) ? raw[0] : raw) as
          | { name: string; icon: string; category?: string; points_reward?: number }
          | null;
        if (a) {
          setTimeout(
            () => showAchievementToast({ achievement_id: r.achievement_id as string, ...a }),
            i * 650,
          );
        }
      });
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1800);
    })();
  }, [user]);

  return { celebrate };
}
