import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './components/auth/AuthProvider';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import OfflineBanner from './components/ui/OfflineBanner';
import PWAInstallBanner from './components/features/PWAInstallBanner';
import CommandPalette from './components/features/CommandPalette';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

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
const QuestsPage = lazy(() => import('./pages/QuestsPage'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const MerchantRegisterPage = lazy(() => import('./pages/MerchantRegisterPage'));
const MerchantDetailPage = lazy(() => import('./pages/MerchantDetailPage'));
const MerchantDashboardPage = lazy(() => import('./pages/MerchantDashboardPage'));
const WalkDetailPage = lazy(() => import('./pages/WalkDetailPage'));
const EcoTipsPage = lazy(() => import('./pages/EcoTipsPage'));
const ContributionHistoryPage = lazy(() => import('./pages/ContributionHistoryPage'));
const YearInReviewPage = lazy(() => import('./pages/YearInReviewPage'));

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

function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  useKeyboardShortcuts();
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <KeyboardShortcutsProvider>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary-500 focus:text-white focus:shadow-lg">
            Skip to main content
          </a>
          <OfflineBanner />
          <PWAInstallBanner />
          <CommandPalette />
          <Toaster
            position="top-center"
            toastOptions={{
              className: '!bg-white/90 dark:!bg-gray-900/90 !backdrop-blur-xl !border !border-white/20 dark:!border-white/10 !shadow-lg !rounded-2xl !text-sm !text-gray-900 dark:!text-white',
              duration: 3000,
            }}
          />
          <Suspense fallback={<PageLoader />}>
          <main id="main-content">
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
            <Route path="/profile/history/:id" element={
              <ProtectedRoute>
                <WalkDetailPage />
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
            <Route path="/merchants/register" element={
              <ProtectedRoute>
                <MerchantRegisterPage />
              </ProtectedRoute>
            } />
            <Route path="/merchants/:id" element={
              <ProtectedRoute>
                <MerchantDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/merchants/:id/manage" element={
              <ProtectedRoute>
                <MerchantDashboardPage />
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
            <Route path="/contribute/history" element={
              <ProtectedRoute>
                <ContributionHistoryPage />
              </ProtectedRoute>
            } />

            {/* Walk — redirects to home since walk is started from map */}
            <Route path="/walk" element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            } />

            {/* Quests */}
            <Route path="/quests" element={
              <ProtectedRoute>
                <QuestsPage />
              </ProtectedRoute>
            } />

            {/* Leaderboard */}
            <Route path="/leaderboard" element={
              <ProtectedRoute>
                <LeaderboardPage />
              </ProtectedRoute>
            } />

            {/* Year in Review */}
            <Route path="/year-in-review" element={
              <ProtectedRoute>
                <YearInReviewPage />
              </ProtectedRoute>
            } />

            {/* Eco Tips */}
            <Route path="/eco-tips" element={<EcoTipsPage />} />

            {/* Info Pages (public) */}
            <Route path="/about" element={<AboutPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />

            {/* Home / Map — public so map always renders */}
            <Route path="/" element={<HomePage />} />
          </Routes>
          </main>
        </Suspense>
        </KeyboardShortcutsProvider>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
