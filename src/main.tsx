import {Component, type ErrorInfo, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  state: ErrorBoundaryState = {hasError: false, message: ''};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected playback or rendering error.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GullyGroove ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#09090D] text-slate-100 p-6 text-center">
          <div className="max-w-md rounded-2xl bg-[#12121A] border border-white/10 p-6 shadow-2xl">
            <h1 className="font-display text-xl font-bold text-white">GullyGroove</h1>
            <p className="mt-2 text-sm text-slate-400">
              Something went wrong while loading the player.
            </p>
            <p className="mt-2 text-xs text-slate-500 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
