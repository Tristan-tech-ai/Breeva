import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initNotifications } from './lib/notifications'
import { initOfflineQueueSync } from './lib/offline-queue'
import { initPwaLifecycle } from './lib/pwa'
import { initWebVitals } from './lib/web-vitals'
import { useSettingsStore } from './stores/settingsStore'

// Apply theme (dark + high-contrast) from the unified settings store before first paint.
// The store reads localStorage synchronously (no FOUC); cloud hydrate reconciles after login.
useSettingsStore.getState().applyTheme();

// Self-heal stale lazy-chunk 404s after a deploy. A tab loaded before a new deploy
// references old asset hashes (e.g. assets/es6-OLD.js) that no longer exist, so the
// first lazy route/import 404s. Reload once to fetch the fresh index (SW serves
// navigations NetworkFirst → new hashes). A 15s sessionStorage stamp prevents loops.
window.addEventListener('vite:preloadError', (event: Event) => {
  const KEY = 'breeva:chunk-reload-at';
  const last = Number(sessionStorage.getItem(KEY) || '0');
  if (Date.now() - last < 15000) return; // already retried recently → let the error UI show
  sessionStorage.setItem(KEY, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

// Error boundary for debugging
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
          <h1>Something went wrong</h1>
          <pre style={{ 
            background: '#f0f0f0', 
            padding: '1rem', 
            borderRadius: '8px',
            overflow: 'auto' 
          }}>
            {this.state.error?.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              background: '#10b981',
              color: 'white',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Register PWA service worker and lifecycle events
initPwaLifecycle();

// Initialize notification system + offline mutation replay
initNotifications().catch(() => {})
initOfflineQueueSync();

// Core Web Vitals measurement (LCP/INP/CLS/FCP/TTFB) — non-blocking, for perf verification.
initWebVitals();
