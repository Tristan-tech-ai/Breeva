import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, isInitialized } = useAuthStore();
  const location = useLocation();
  const [timedOut, setTimedOut] = useState(false);

  // Safety timeout: if auth doesn't resolve in 5s, stop blocking
  useEffect(() => {
    if (isInitialized && !isLoading) return;
    const timer = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, [isInitialized, isLoading]);

  const stillLoading = (!isInitialized || isLoading) && !timedOut;

  // Show loading while checking session (max 5s)
  if (stillLoading) {
    return (
      <div className="gradient-mesh-bg min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
