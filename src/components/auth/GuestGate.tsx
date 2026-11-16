import { lazy, type ReactNode } from 'react';
import { useIsGuest } from '../../stores/guestStore';

// Loaded on demand: the honest card pulls in the bottom navigation (framer-motion).
const GuestOnlyPage = lazy(() => import('../../pages/GuestOnlyPage'));

/**
 * Pages that need the account server: a guest gets an honest card instead (the page itself is not mounted, so it makes
 * no request). `walks` shows the walks recorded on this device under the card (walk history).
 */
export function GuestGate({ title, walks = false, children }: { title: string; walks?: boolean; children: ReactNode }) {
  const guest = useIsGuest();
  if (!guest) return <>{children}</>;
  return <GuestOnlyPage title={title} walks={walks} />;
}
