// Breeva Notification System — Service Worker registration + local notifications
import { formatLocalDateYYYYMMDD } from './utils';
import { useSettingsStore } from '../stores/settingsStore';

/** Request notification permission */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

/** Check if notifications are enabled (browser permission granted). */
export function isNotificationEnabled(): boolean {
  return 'Notification' in window && Notification.permission === 'granted';
}

/** Master push toggle (Settings → Notifications → Push). Gates ALL local notifications. */
function pushEnabled(): boolean {
  return useSettingsStore.getState().push_notifications;
}
/** Quest reminders require BOTH the master push toggle and the quest sub-toggle. */
function questEnabled(): boolean {
  const s = useSettingsStore.getState();
  return s.push_notifications && s.quest_reminders;
}

/** Show a local notification (via service worker if available, fallback to Notification API) */
export async function showNotification(
  title: string,
  body: string,
  options?: { icon?: string; url?: string; tag?: string }
): Promise<void> {
  if (!isNotificationEnabled()) return;

  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: options?.icon || '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: options?.tag,
        data: options?.url ? { url: options.url } : undefined,
      });
    } else {
      new Notification(title, { body, icon: options?.icon || '/icons/icon-192.png', tag: options?.tag });
    }
  } catch {
    // Silently fail
  }
}

/** Clear a pending streak reminder timer. */
export function clearStreakReminder(): void {
  const t = localStorage.getItem('breeva_streak_timer');
  if (t) { clearTimeout(Number(t)); localStorage.removeItem('breeva_streak_timer'); }
}

/** Clear a pending quest reminder timer. */
export function clearQuestReminder(): void {
  const t = localStorage.getItem('breeva_quest_timer');
  if (t) { clearTimeout(Number(t)); localStorage.removeItem('breeva_quest_timer'); }
}

/** Schedule a streak warning notification. Gated on browser permission + push toggle. */
export function scheduleStreakReminder(): void {
  if (!isNotificationEnabled() || !pushEnabled()) { clearStreakReminder(); return; }

  const now = new Date();
  const evening = new Date(now);
  evening.setHours(19, 0, 0, 0); // 7 PM

  if (now > evening) {
    evening.setDate(evening.getDate() + 1);
  }

  const delay = evening.getTime() - now.getTime();

  const existingTimer = localStorage.getItem('breeva_streak_timer');
  if (existingTimer) clearTimeout(Number(existingTimer));

  const timerId = setTimeout(() => {
    // Re-check at fire time: the user may have toggled push off after scheduling.
    if (!pushEnabled()) return;
    const lastWalkDate = localStorage.getItem('breeva_last_walk_date');
    const today = formatLocalDateYYYYMMDD();

    if (lastWalkDate !== today) {
      showNotification(
        '🔥 Streak Warning!',
        "You haven't walked today. Don't break your streak!",
        { url: '/home', tag: 'streak-warning' }
      );
    }
    // Reschedule for next day
    scheduleStreakReminder();
  }, delay);

  localStorage.setItem('breeva_streak_timer', String(timerId));
}

/** Schedule daily quest reminder. Gated on browser permission + push toggle + quest toggle. */
export function scheduleQuestReminder(): void {
  if (!isNotificationEnabled() || !questEnabled()) { clearQuestReminder(); return; }

  const now = new Date();
  const reminder = new Date(now);
  reminder.setHours(12, 0, 0, 0); // Noon

  if (now > reminder) {
    reminder.setDate(reminder.getDate() + 1);
  }

  const delay = reminder.getTime() - now.getTime();

  const existingTimer = localStorage.getItem('breeva_quest_timer');
  if (existingTimer) clearTimeout(Number(existingTimer));

  const timerId = setTimeout(() => {
    if (!questEnabled()) return; // re-check at fire time
    showNotification(
      '🎯 Daily Quests Available!',
      'Complete your daily quests to earn bonus EcoPoints.',
      { url: '/quests', tag: 'quest-reminder' }
    );
    scheduleQuestReminder();
  }, delay);

  localStorage.setItem('breeva_quest_timer', String(timerId));
}

/** Reconcile scheduled reminders with the current toggle state (schedule or clear). */
export function applyNotificationSettings(): void {
  scheduleStreakReminder(); // self-clears if push is off
  scheduleQuestReminder();  // self-clears if push or quest is off
}

let notifSubscribed = false;

/** Initialize notification system + react to runtime toggle changes. */
export async function initNotifications(): Promise<void> {
  applyNotificationSettings();
  // Reschedule/clear whenever the push or quest toggle flips (once per app session).
  if (!notifSubscribed) {
    notifSubscribed = true;
    let prevPush = useSettingsStore.getState().push_notifications;
    let prevQuest = useSettingsStore.getState().quest_reminders;
    useSettingsStore.subscribe((s) => {
      if (s.push_notifications !== prevPush || s.quest_reminders !== prevQuest) {
        prevPush = s.push_notifications;
        prevQuest = s.quest_reminders;
        applyNotificationSettings();
      }
    });
  }
}
