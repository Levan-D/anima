import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { reportError } from '@/lib/reportError';

type Props = {
  children: ReactNode;
  /** What to show instead of the usual "Try again". */
  fallback?: ReactNode;
};

type State = {
  failure: { error: unknown } | null;
};

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failure: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failure: { error } };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError(error, info.componentStack ?? null);
  }

  private readonly retry = (): void => {
    this.setState({ failure: null });
  };

  override render(): ReactNode {
    const { failure } = this.state;
    const { children, fallback } = this.props;
    if (!failure) return children;
    return fallback === undefined ? <ErrorState error={failure.error} onRetry={this.retry} /> : fallback;
  }
}
