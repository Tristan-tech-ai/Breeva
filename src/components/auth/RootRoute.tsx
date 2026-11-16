import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

const ExploreMapPage = lazy(() => import('../../pages/ExploreMapPage'));

/** `/`: the live map for guests (no account needed), the app map for signed-in users. */
export default function RootRoute() {
  const user = useAuthStore((s) => s.user);
  if (user) return <Navigate to="/home" replace />;
  return <ExploreMapPage />;
}
