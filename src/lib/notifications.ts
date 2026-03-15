// Breeva Notification System — Service Worker registration + local notifications

/** Register service worker */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch {
    return null;
  }
}

/** Request notification permission */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

/** Check if notifications are enabled */
export function isNotificationEnabled(): boolean {
  return 'Notification' in window && Notification.permission === 'granted';
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
        icon: options?.icon || '/icon-192.png',
        badge: '/icon-192.png',
        tag: options?.tag,
        data: options?.url ? { url: options.url } : undefined,
      });
    } else {
      new Notification(title, { body, icon: options?.icon || '/icon-192.png', tag: options?.tag });
    }
  } catch {
    // Silently fail
  }
}

/** Schedule a streak warning notification */
export function scheduleStreakReminder(): void {
  if (!isNotificationEnabled()) return;

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
    const lastWalkDate = localStorage.getItem('breeva_last_walk_date');
    const today = new Date().toISOString().split('T')[0];

    if (lastWalkDate !== today) {
      showNotification(
        '🔥 Streak Warning!',
        "You haven't walked today. Don't break your streak!",
        { url: '/', tag: 'streak-warning' }
      );
    }
    // Reschedule for next day
    scheduleStreakReminder();
  }, delay);

  localStorage.setItem('breeva_streak_timer', String(timerId));
}

/** Schedule daily quest reminder */
export function scheduleQuestReminder(): void {
  if (!isNotificationEnabled()) return;

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
    showNotification(
      '🎯 Daily Quests Available!',
      'Complete your daily quests to earn bonus EcoPoints.',
      { url: '/quests', tag: 'quest-reminder' }
    );
    scheduleQuestReminder();
  }, delay);

  localStorage.setItem('breeva_quest_timer', String(timerId));
}

/** Initialize notification system */
export async function initNotifications(): Promise<void> {
  await registerServiceWorker();

  if (isNotificationEnabled()) {
    scheduleStreakReminder();
    scheduleQuestReminder();
  }
}
