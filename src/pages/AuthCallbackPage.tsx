import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { user, fetchProfile } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const navigatedRef = useRef(false);

  // React to user becoming available in the auth store.
  // The actual PKCE code exchange is handled automatically by Supabase's
  // detectSessionInUrl: true + AuthProvider's onAuthStateChange / initialize().
  useEffect(() => {
    if (user && !navigatedRef.current) {
      navigatedRef.current = true;

      // Ensure profile is loaded, then navigate
      fetchProfile()
        .catch(console.error)
        .finally(() => {
          const onboardingCompleted = localStorage.getItem('breeva_onboarding_completed');
          navigate(
            onboardingCompleted === 'true' ? '/home' : '/onboarding/welcome',
            { replace: true }
          );
        });
    }
  }, [user, fetchProfile, navigate]);

  // Safety timeout: if no user after 10 seconds, show error and redirect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().user && !navigatedRef.current) {
        setError('Authentication timed out. Please try again.');
        setTimeout(() => navigate('/login', { replace: true }), 3000);
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [navigate]);

  if (error) {
    return (
      <div className="gradient-mesh-bg min-h-screen flex items-center justify-center p-6">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Authentication Failed
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">{error}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="gradient-mesh-bg min-h-screen flex items-center justify-center p-6">
      <div className="glass-card p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 mx-auto mb-4 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          Signing you in...
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Setting up your eco-walking profile
        </p>
      </div>
    </div>
  );
}
