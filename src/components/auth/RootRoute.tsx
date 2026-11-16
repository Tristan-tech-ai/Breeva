import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useIsGuest } from '../../stores/guestStore';

const ExploreMapPage = lazy(() => import('../../pages/ExploreMapPage'));

/**
 * `/`: the live map for visitors (no account needed), the app map for signed-in users and for those who entered the
 * app in guest mode.
 */
export default function RootRoute() {
  const user = useAuthStore((s) => s.user);
  const guest = useIsGuest();
  if (user) return <Navigate to="/home" replace />;
  if (guest) return <Navigate to="/home" replace />;
  return <ExploreMapPage />;
}
