import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Global keyboard shortcuts for desktop power users.
 * - Ctrl/Cmd+K: Focus search (dispatches custom event)
 * - g then h: Go Home
 * - g then p: Go Profile
 * - g then m: Go Merchants
 * - g then r: Go Rewards
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    let gPressed = false;
    let gTimer: ReturnType<typeof setTimeout>;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl/Cmd+K: focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('breeva:focus-search'));
        return;
      }

      if (isInput) return;

      // g-prefix shortcuts
      if (e.key === 'g' && !gPressed) {
        gPressed = true;
        gTimer = setTimeout(() => { gPressed = false; }, 500);
        return;
      }

      if (gPressed) {
        gPressed = false;
        clearTimeout(gTimer);
        switch (e.key) {
          case 'h': navigate('/'); break;
          case 'p': navigate('/profile'); break;
          case 'm': navigate('/merchants'); break;
          case 'r': navigate('/rewards'); break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
