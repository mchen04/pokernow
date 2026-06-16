import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

// Catches render errors so a single bad frame never white-screens the table.
// The realtime state keeps flowing, so "Reload" almost always recovers.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#201e1f] p-6 text-center text-white">
          <div className="text-3xl">♠️</div>
          <h1 className="font-display text-xl font-bold">Something hiccuped at the table</h1>
          <p className="max-w-sm text-sm text-white/60">
            The game kept running on the server — reload to drop back into your seat (your
            chips and cards are safe).
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-emerald-700 px-5 py-2 font-semibold text-white hover:bg-emerald-600"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
