// "Best on mobile" nudge — shown once per session to logged-in users on a desktop
// viewport. Breeva is a mobile-first PWA, so on a wide screen we gently suggest the
// phone. A "don't show again" checkbox stores a permanent opt-out.
//
// Show rules: user is logged in · viewport ≥1024px · not on /login or / (landing) ·
// not permanently hidden (localStorage) · not already shown this browser session.

import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Smartphone, X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useLocale } from '../../stores/settingsStore';

const HIDE_KEY = 'breeva_hide_desktop_tip';   // permanent opt-out (localStorage)
const SEEN_KEY = 'breeva_desktop_tip_seen';   // once per session (sessionStorage)

const TXT = {
  id: {
    title: 'Lebih nyaman di ponsel',
    body: 'Breeva dirancang untuk layar ponsel — peta udara per-jalan, navigasi rute, dan pelacakan jalan kaki paling pas dipakai di HP.',
    tip: 'Buka breeva.site di ponsel, atau pasang sebagai aplikasi (Tambahkan ke Layar Utama).',
    dont: 'Jangan tampilkan lagi',
    ok: 'Mengerti',
    close: 'Tutup',
  },
  en: {
    title: 'Best on your phone',
    body: 'Breeva is built for the phone — the per-road air map, route navigation, and walk tracking all work best on mobile.',
    tip: 'Open breeva.site on your phone, or install it as an app (Add to Home Screen).',
    dont: "Don't show again",
    ok: 'Got it',
    close: 'Close',
  },
};

export default function DesktopNudge() {
  const user = useAuthStore((s) => s.user);
  const locale = useLocale();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const t = TXT[locale === 'id' ? 'id' : 'en'];

  useEffect(() => {
    if (!user) return;
    if (pathname === '/login' || pathname === '/') return;
    if (localStorage.getItem(HIDE_KEY) === '1') return;
    if (sessionStorage.getItem(SEEN_KEY) === '1') return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const tmr = setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem(SEEN_KEY, '1');
    }, 700);
    return () => clearTimeout(tmr);
  }, [user, pathname]);

  const close = () => {
    if (dontShow) localStorage.setItem(HIDE_KEY, '1');
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={close} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 text-center shadow-2xl"
          >
            <button onClick={close} aria-label={t.close} className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 transition">
              <X className="w-5 h-5" />
            </button>
            <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 shadow-md">
              <Smartphone className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">{t.title}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">{t.body}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2.5 leading-relaxed">{t.tip}</p>
            <label className="flex items-center justify-center gap-2 mt-5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShow}
                onChange={(e) => setDontShow(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-600"
              />
              {t.dont}
            </label>
            <button onClick={close} className="mt-4 w-full py-3 rounded-xl gradient-primary text-white font-bold text-sm shadow-lg shadow-primary-500/20 active:scale-[0.98] transition">
              {t.ok}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
