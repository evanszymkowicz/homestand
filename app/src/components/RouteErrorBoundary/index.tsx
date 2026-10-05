import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  routeName: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Error in ${this.props.routeName}:`, error, info.componentStack);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8 text-center text-ink-dim">
        <div>
          <p>Something went wrong loading {this.props.routeName}.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 text-accent underline">
            Try again
          </button>
        </div>
      </div>
    );
  }
}
