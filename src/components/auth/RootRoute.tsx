import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useIsGuest } from '../../stores/guestStore';

const LandingPage = lazy(() => import('../../pages/LandingPage'));

/**
 * `/`: the 3D landing for visitors (N-02, 25 Nov 2026; Tristan kept the 3D design; the live map is /peta), the app map for signed-in users and
 * for those who entered the app in guest mode.
 */
export default function RootRoute() {
  const user = useAuthStore((s) => s.user);
  const guest = useIsGuest();
  if (user) return <Navigate to="/home" replace />;
  if (guest) return <Navigate to="/home" replace />;
  return <LandingPage />;
}
