import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Root recovery boundary: an unhandled render error shows this fallback
 *  Data.ts evicts rejected promises, so a fresh mount re-fetches.
*/
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8 text-ink">
        <div className="max-w-md rounded-lg border border-border bg-surface p-6 text-center shadow-sm">
          <h1 className="text-heading font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm break-words text-ink-dim">
            {String(this.state.error?.message ?? "Unknown error").slice(0, 200)}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Try again
          </button>
        </div>
      </div>
    );
  }
}
