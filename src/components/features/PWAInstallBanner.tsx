import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The install offer waits this long after the app started, so a first look (or a demo recording) is not covered by it. */
export const TUNDA_PASANG_MS = 60_000;
const mulai = typeof performance !== 'undefined' ? performance.timeOrigin : Date.now();

/** Whether the install banner may show: an install offer exists, not dismissed, not on /developers, and late enough. */
export function bolehTampil(adaTawaran: boolean, ditolak: boolean, pathname: string, sejakMulaiMs: number): boolean {
  return adaTawaran && !ditolak && pathname !== '/developers' && sejakMulaiMs >= TUNDA_PASANG_MS;
}

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('breeva_pwa_dismissed') === '1');
  const { pathname } = useLocation();
  const [cukupLama, setCukupLama] = useState(() => Date.now() - mulai >= TUNDA_PASANG_MS);
  useEffect(() => {
    if (cukupLama) return;
    const t = setTimeout(() => setCukupLama(true), Math.max(0, TUNDA_PASANG_MS - (Date.now() - mulai)));
    return () => clearTimeout(t);
  }, [cukupLama]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setDismissed(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setDismissed(true);
    }
  }, [deferredPrompt]);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('breeva_pwa_dismissed', '1');
  };

  // Hide on the developer landing (a marketing hero) and during the first minute of a session.
  if (!bolehTampil(!!deferredPrompt, dismissed, pathname, cukupLama ? TUNDA_PASANG_MS : 0)) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        className="fixed bottom-20 left-4 right-4 z-50 glass-card p-4 flex items-center gap-3 shadow-xl border border-primary-200 dark:border-primary-800"
      >
        <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Pasang Breeva</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">Buka dari layar utama seperti aplikasi, juga tanpa internet</p>
        </div>
        <button
          onClick={install}
          className="gradient-primary text-white text-xs font-semibold px-4 py-2 rounded-xl flex-shrink-0"
        >
          Pasang
        </button>
        <button aria-label="Tutup" onClick={dismiss} className="text-gray-400 p-1 flex-shrink-0">
          <X size={16} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
