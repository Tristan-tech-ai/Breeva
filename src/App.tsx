import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/auth/AuthProvider';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

// Eager load: critical path pages
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';

// Lazy load: all other pages for fast initial load
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const EditProfilePage = lazy(() => import('./pages/EditProfilePage'));
const WalkHistoryPage = lazy(() => import('./pages/WalkHistoryPage'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MerchantsPage = lazy(() => import('./pages/MerchantsPage'));
const RewardsPage = lazy(() => import('./pages/RewardsPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const SavedPlacesPage = lazy(() => import('./pages/SavedPlacesPage'));
const EcoImpactPage = lazy(() => import('./pages/EcoImpactPage'));
const ContributePage = lazy(() => import('./pages/ContributePage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));

// Page loading fallback — minimal skeleton
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">Loading...</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/landing" element={<LandingPage />} />

            {/* Onboarding (requires auth but not full protection) */}
            <Route path="/onboarding/*" element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            } />

            {/* Protected Routes */}
            <Route path="/profile" element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            } />
            <Route path="/profile/edit" element={
              <ProtectedRoute>
                <EditProfilePage />
              </ProtectedRoute>
            } />
            <Route path="/profile/history" element={
              <ProtectedRoute>
                <WalkHistoryPage />
              </ProtectedRoute>
            } />
            <Route path="/profile/achievements" element={
              <ProtectedRoute>
                <AchievementsPage />
              </ProtectedRoute>
            } />
            <Route path="/profile/transactions" element={
              <ProtectedRoute>
                <TransactionsPage />
              </ProtectedRoute>
            } />
            <Route path="/profile/settings" element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            } />

            {/* Merchants */}
            <Route path="/merchants" element={
              <ProtectedRoute>
                <MerchantsPage />
              </ProtectedRoute>
            } />

            {/* Rewards */}
            <Route path="/rewards" element={
              <ProtectedRoute>
                <RewardsPage />
              </ProtectedRoute>
            } />

            {/* Saved Places */}
            <Route path="/saved" element={
              <ProtectedRoute>
                <SavedPlacesPage />
              </ProtectedRoute>
            } />

            {/* Eco Impact / Timeline */}
            <Route path="/eco-impact" element={
              <ProtectedRoute>
                <EcoImpactPage />
              </ProtectedRoute>
            } />

            {/* Contribute / Add Place */}
            <Route path="/contribute" element={
              <ProtectedRoute>
                <ContributePage />
              </ProtectedRoute>
            } />

            {/* Walk — redirects to home since walk is started from map */}
            <Route path="/walk" element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            } />

            {/* Info Pages (public) */}
            <Route path="/about" element={<AboutPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />

            {/* Home / Map — public so map always renders */}
            <Route path="/" element={<HomePage />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
