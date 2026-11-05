import React from 'react';

export function Skeleton({ className = '', ...props }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--bg-elevated)] ${className}`}
      {...props}
    />
  );
}

export function SuggestionCardSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-3">
      <div className="flex justify-between items-center">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="flex gap-4 items-center">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-6" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 flex-1" />
      </div>
    </div>
  );
}

export function TableRowSkeleton({ columns = 7 }) {
  return (
    <tr className="border-b border-[var(--border-subtle)]">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Sentinel UI caught an unhandled exception:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] p-6">
          <div className="max-w-md w-full p-6 rounded-2xl border border-rose-500/30 bg-[var(--bg-surface)] text-center shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 mx-auto flex items-center justify-center text-xl font-bold mb-4">
              !
            </div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              An unexpected render error occurred
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
              {this.state.error?.message || 'Sentinel interface encountered an unexpected state.'}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[var(--accent-primary)] hover:opacity-90 text-black font-semibold cursor-pointer"
              >
                Reload Window
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
