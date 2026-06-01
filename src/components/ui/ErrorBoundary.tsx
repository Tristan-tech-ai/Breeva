import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// A lazy chunk that 404'd because the session predates the latest deploy.
// Resetting state would just re-attempt the dead import — only a reload fixes it.
function isChunkError(err: Error | null): boolean {
  const m = err?.message || '';
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|error loading dynamically/i.test(m);
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    if (isChunkError(error)) {
      const KEY = 'breeva:chunk-reload-at';
      const last = Number(sessionStorage.getItem(KEY) || '0');
      if (Date.now() - last > 15000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload(); // fetch fresh index + asset hashes
      }
    }
  }

  handleReset = () => {
    if (isChunkError(this.state.error)) { window.location.reload(); return; }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-[300px] flex items-center justify-center p-6">
          <div className="glass-card p-6 max-w-sm w-full text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-danger-50 dark:bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-danger-500" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Something went wrong
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 gradient-primary text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-xl transition-shadow"
              >
                <RotateCcw className="w-4 h-4" />
                Try Again
              </button>
              <a
                href="/home"
                className="flex items-center gap-2 glass-button px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <Home className="w-4 h-4" />
                Home
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
