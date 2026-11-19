import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './components/auth/AuthProvider';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { GuestGate } from './components/auth/GuestGate';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ContentPageSkeleton } from './components/ui/Skeleton';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

// Eager load: critical path pages
// The app map loads on demand: the front door (/) is the public map, so the full app is not in the entry bundle.
const HomePage = lazy(() => import('./pages/HomePage'));
// Overlays and the login page pull in framer-motion; loading them on demand keeps it out of the first download.
const AppOverlays = lazy(() => import('./components/AppOverlays'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
import RootRoute from './components/auth/RootRoute';
import { afterFirstDraw } from './lib/field/firstDraw';
import { OVERLAYS_FALLBACK_MS, overlaysWait } from './lib/overlaysWait';

// Lazy load: all other pages for fast initial load
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
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
const PaparanPage = lazy(() => import('./pages/PaparanPage'));
const PrioritasPage = lazy(() => import('./pages/PrioritasPage'));
const ValidasiPage = lazy(() => import('./pages/ValidasiPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const UjiCobaPage = lazy(() => import('./pages/UjiCobaPage'));
const UjiCobaRekapPage = lazy(() => import('./pages/UjiCobaRekapPage'));
const ExploreMapPage = lazy(() => import('./pages/ExploreMapPage'));
const CityAirPage = lazy(() => import('./pages/CityAirPage'));
const DevelopersPage = lazy(() => import('./pages/DevelopersPage'));
const DeveloperLandingPage = lazy(() => import('./pages/DeveloperLandingPage'));
const DeveloperDashboardPage = lazy(() => import('./pages/DeveloperDashboardPage'));

// Page loading fallback — content-shaped skeleton (avoids the blank flash of a bare spinner).
function PageLoader() {
  return <ContentPageSkeleton />;
}

// The in-app route cards copy links with this page's path (/home?rute=...): those open on the public map, which plays
// them for anyone, signed in or not.
function HomeRoute() {
  const { search } = useLocation();
  if (new URLSearchParams(search).has('rute')) return <Navigate to={`/peta${search}`} replace />;
  return (
    <ProtectedRoute>
      <HomePage />
    </ProtectedRoute>
  );
}

function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  useKeyboardShortcuts();
  return <>{children}</>;
}

/** The app-wide overlays; on a map page only after the first field draw (X-W62, lib/overlaysWait.ts). */
function OverlaysWhenReady() {
  const [on, setOn] = useState(() => !overlaysWait(window.location.pathname));
  useEffect(() => {
    if (on) return;
    let live = true;
    void afterFirstDraw(window, OVERLAYS_FALLBACK_MS).then(() => { if (live) setOn(true); });
    return () => { live = false; };
  }, [on]);
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <AppOverlays />
    </Suspense>
  );
}

function App() {
  useEffect(() => {
    const flagKey = 'breeva:chunk-reload-once';

    const shouldHandle = (reason: unknown): boolean => {
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : '';
      return message.includes('Failed to fetch dynamically imported module');
    };

    const reloadOnce = () => {
      if (sessionStorage.getItem(flagKey) === '1') return;
      sessionStorage.setItem(flagKey, '1');
      window.location.reload();
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (shouldHandle(event.reason)) reloadOnce();
    };

    const onWindowError = (event: ErrorEvent) => {
      if (shouldHandle(event.error ?? event.message)) reloadOnce();
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onWindowError);

    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onWindowError);
    };
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <KeyboardShortcutsProvider>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary-500 focus:text-white focus:shadow-lg">
            Skip to main content
          </a>
          <OverlaysWhenReady />
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
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Onboarding (requires auth but not full protection) */}
            <Route path="/onboarding/*" element={
              <ProtectedRoute>
                <GuestGate title="Pengenalan">
                  <OnboardingPage />
                </GuestGate>
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
                <GuestGate title="Ubah profil">
                  <EditProfilePage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/profile/history" element={
              <ProtectedRoute>
                <GuestGate title="Riwayat jalan" walks>
                  <WalkHistoryPage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/profile/history/:id" element={
              <ProtectedRoute>
                <GuestGate title="Detail jalan" walks>
                  <WalkDetailPage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/profile/achievements" element={
              <ProtectedRoute>
                <GuestGate title="Pencapaian">
                  <AchievementsPage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/profile/transactions" element={
              <ProtectedRoute>
                <GuestGate title="Transaksi poin">
                  <TransactionsPage />
                </GuestGate>
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
                <GuestGate title="Merchant">
                  <MerchantsPage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/merchants/register" element={
              <ProtectedRoute>
                <GuestGate title="Daftar merchant">
                  <MerchantRegisterPage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/merchants/:id" element={
              <ProtectedRoute>
                <GuestGate title="Merchant">
                  <MerchantDetailPage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/merchants/:id/manage" element={
              <ProtectedRoute>
                <GuestGate title="Kelola merchant">
                  <MerchantDashboardPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Rewards */}
            <Route path="/rewards" element={
              <ProtectedRoute>
                <GuestGate title="Hadiah">
                  <RewardsPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Saved Places */}
            <Route path="/saved" element={
              <ProtectedRoute>
                <SavedPlacesPage />
              </ProtectedRoute>
            } />

            {/* Developer API — public marketing landing (SEO-indexed) */}
            <Route path="/developers" element={<DeveloperLandingPage />} />

            {/* Developer API — authed key management */}
            <Route path="/developers/keys" element={
              <ProtectedRoute>
                <GuestGate title="Developer API">
                  <DevelopersPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Developer API — monitoring dashboard */}
            <Route path="/developers/dashboard" element={
              <ProtectedRoute>
                <GuestGate title="Developer API">
                  <DeveloperDashboardPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Eco Impact / Timeline */}
            <Route path="/eco-impact" element={
              <ProtectedRoute>
                <GuestGate title="Dampak lingkungan">
                  <EcoImpactPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Contribute / Add Place */}
            <Route path="/contribute" element={
              <ProtectedRoute>
                <GuestGate title="Kontribusi">
                  <ContributePage />
                </GuestGate>
              </ProtectedRoute>
            } />
            <Route path="/contribute/history" element={
              <ProtectedRoute>
                <GuestGate title="Riwayat kontribusi">
                  <ContributionHistoryPage />
                </GuestGate>
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
                <GuestGate title="Misi">
                  <QuestsPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Leaderboard */}
            <Route path="/leaderboard" element={
              <ProtectedRoute>
                <GuestGate title="Papan peringkat">
                  <LeaderboardPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Year in Review */}
            <Route path="/year-in-review" element={
              <ProtectedRoute>
                <GuestGate title="Kilas balik tahun">
                  <YearInReviewPage />
                </GuestGate>
              </ProtectedRoute>
            } />

            {/* Eco Tips */}
            <Route path="/eco-tips" element={<EcoTipsPage />} />

            {/* Layer 3 — Exposure Risk Calculator (public; saved-walk source needs login) */}
            <Route path="/paparan" element={<PaparanPage />} />

            {/* Public priority list of schools and health facilities (no auth) */}
            <Route path="/prioritas" element={<PrioritasPage />} />
            <Route path="/validasi" element={<ValidasiPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/uji-coba" element={<UjiCobaPage />} />
            <Route path="/uji-coba/rekap" element={<UjiCobaRekapPage />} />

            {/* Public live-map showcase + per-city AQI pages (crawlable, no auth, prerendered) */}
            <Route path="/peta" element={<ExploreMapPage />} />
            <Route path="/udara/:slug" element={<CityAirPage />} />

            {/* Info Pages (public) */}
            <Route path="/about" element={<AboutPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />

            {/* Home / Map — protected, requires auth */}
            <Route path="/home" element={<HomeRoute />} />

            {/* Root: map first. Guests see the live coloured map with its legend; signed-in users go to the app. */}
            <Route path="/" element={<RootRoute />} />
            {/* Product story (former root) */}
            <Route path="/landing" element={<LandingPage />} />
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
