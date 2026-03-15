import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initNotifications } from './lib/notifications'

// Force light mode as default. Only enable dark if user explicitly toggled it.
// This overrides device-level dark mode (prefers-color-scheme: dark).
const userExplicitlySetDark = localStorage.getItem('breeva_dark_mode') === 'true';
document.documentElement.classList.remove('dark');
if (userExplicitlySetDark) {
  document.documentElement.classList.add('dark');
}

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

// Initialize service worker & notification system
initNotifications().catch(() => {})
