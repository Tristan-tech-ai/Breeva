import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

/**
 * "Buka aplikasi": opens the full app at /home. Without an account the visitor enters guest mode (F1-17), so the app
 * opens instead of the sign-in page while account sign-in is unavailable; a signed-in user just goes to the app.
 */
export default function OpenAppLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Link to="/home" onClick={() => useAuthStore.getState().enterGuest()} className={className}>
      {children}
    </Link>
  );
}
