import React from 'react';
import ErrorFallback from './ErrorFallback';
import { classifyError, isTransientNetworkError, type ErrorType } from './errorClassification';
import { toast } from '../../stores/toastStore';
import { useAIStatusStore } from '../../stores/aiStatusStore';
import { useSettingsStore } from '../../features/settings/stores/useSettingsStore';

type NullableError = Error | null;

export interface AIServiceErrorBoundaryProps {
  feature?: string;
  onRetry?: () => Promise<unknown> | unknown;
  onReset?: () => void;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface AIServiceErrorBoundaryState {
  hasError: boolean;
  error: NullableError;
  errorType: ErrorType;
  canRetry: boolean;
  retryCount: number;
  renderKey: number;
}

const INITIAL_STATE: AIServiceErrorBoundaryState = {
  hasError: false,
  error: null,
  errorType: 'unknown',
  canRetry: false,
  retryCount: 0,
  renderKey: 0,
};

function makeErrorSummary(feature: string | undefined, error: NullableError): string {
  const name = error?.name ?? 'Error';
  const msg = error?.message ?? '(no message)';
  return `[${feature ?? 'unknown-feature'}] ${name}: ${msg}`;
}

export default class AIServiceErrorBoundary extends React.Component<
  AIServiceErrorBoundaryProps,
  AIServiceErrorBoundaryState
> {
  private _unmounted = false;
  private _autoRetryTimer: number | null = null;

  constructor(props: AIServiceErrorBoundaryProps) {
    super(props);
    this.state = { ...INITIAL_STATE };

    this.handleRetry = this.handleRetry.bind(this);
    this.handleReset = this.handleReset.bind(this);
    this.performRetry = this.performRetry.bind(this);
    this.openSettings = this.openSettings.bind(this);
  }

  static getDerivedStateFromError(error: Error): Partial<AIServiceErrorBoundaryState> {
    const type = classifyError(error);
    const canRetry =
      type === 'network' ? true : type === 'service' ? true : false;
    return {
      hasError: true,
      error,
      errorType: type,
      canRetry,
      // retryCount preserved from existing state by React merge; initialize if first time
      retryCount: 0,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { feature } = this.props;
    // Always log with context
    
    console.error('[AIServiceErrorBoundary]', { feature, error, errorInfo });

    // Do not toast for key errors (handled by fallback UI)
    const type = classifyError(error);
    if (type === 'key') return;

    try {
      if (type === 'network') {
        toast.warning('Network issue', makeErrorSummary(feature, error));
      } else if (type === 'service') {
        toast.warning('AI service unavailable', makeErrorSummary(feature, error));
      } else {
        // Unknown: include action to copy minimal diagnostics
        const summary = makeErrorSummary(feature, error);
        toast.addToast({
          type: 'error',
          title: 'Unexpected error',
          message: summary,
          action: {
            label: 'Copy details',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(summary);
                toast.info('Copied', 'Error details copied to clipboard');
              } catch {
                toast.warning('Copy Failed', 'Unable to copy error details');
              }
            },
          },
        });
      }
    } catch {
      // ignore toast failures
    }
  }

  componentDidUpdate(prevProps: AIServiceErrorBoundaryProps, prevState: AIServiceErrorBoundaryState) {
    // Auto-retry only for transient network category, up to 3 attempts
    if (
      this.state.hasError &&
      this.state.errorType === 'network' &&
      this.state.retryCount < 3 &&
      prevState.retryCount === this.state.retryCount // ensure we only schedule once per count
    ) {
      const backoff = Math.max(250, 500 * Math.max(1, this.state.retryCount));
      this.scheduleAutoRetry(backoff);
    }
  }

  componentWillUnmount(): void {
    this._unmounted = true;
    if (this._autoRetryTimer) {
      clearTimeout(this._autoRetryTimer);
      this._autoRetryTimer = null;
    }
  }

  private scheduleAutoRetry(delayMs: number) {
    if (this._autoRetryTimer) {
      clearTimeout(this._autoRetryTimer);
      this._autoRetryTimer = null;
    }
    this._autoRetryTimer = window.setTimeout(async () => {
      this._autoRetryTimer = null;
      // Only attempt if still in error and network type
      if (!this.state.hasError || this.state.errorType !== 'network') return;
      const ok = await this.performRetry(true);
      if (!ok) {
        // Increment retry count on failed auto-attempt
        if (!this._unmounted) {
          this.setState((s) => ({ retryCount: s.retryCount + 1 }));
        }
      }
    }, delayMs);
  }

  private async performRetry(auto = false): Promise<boolean> {
    if (!this.state.canRetry) return false;

    // First try feature-specific retry if provided
    try {
      if (typeof this.props.onRetry === 'function') {
        const res = this.props.onRetry();
        if (res && typeof (res as Promise<unknown>).then === 'function') {
          await (res as Promise<unknown>);
        }
        // If no error thrown/rejected, consider recovered
        this.resetBoundary(true);
        return true;
      }
    } catch (_err) {
      // fallthrough to store-level retry
    }

    // Then try store-level AI status revalidation
    try {
      const state = useAIStatusStore.getState?.();
      const fn = state?.checkStatus;
      if (typeof fn === 'function') {
        await fn();
      }
      // Consider success if no exception thrown
      this.resetBoundary(true);
      return true;
    } catch (_err) {
      // If not transient (heuristic), disable further auto retries
      if (auto && !isTransientNetworkError(_err)) {
        if (!this._unmounted) {
          this.setState({ canRetry: false });
        }
      }
      return false;
    }
  }

  private handleRetry(): void {
    if (!this.state.canRetry) return;
    void this.performRetry(false);
  }

  private handleReset(): void {
    this.resetBoundary(false);
    try {
      if (typeof this.props.onReset === 'function') {
        this.props.onReset();
      }
    } catch {
      // ignore reset handler errors
    }
  }

  private resetBoundary(fromRetry: boolean) {
    if (this._unmounted) return;
    if (this._autoRetryTimer) {
      clearTimeout(this._autoRetryTimer);
      this._autoRetryTimer = null;
    }
    this.setState((s) => ({
      ...INITIAL_STATE,
      renderKey: s.renderKey + 1, // bump key to remount children
    }));
    if (fromRetry) {
      try {
        toast.success('Recovered', 'Operation resumed after transient error');
      } catch {
        // ignore toast errors
      }
    }
  }

  private openSettings(): void {
    try {
      const fn = useSettingsStore.getState?.().openSettings;
      if (typeof fn === 'function') fn();
    } catch {
      // swallow
    }
  }

  render(): React.ReactNode {
    const { children, fallback, feature } = this.props;
    const { hasError, error, errorType, canRetry, retryCount, renderKey } = this.state;

    if (!hasError) {
      return <div key={renderKey}>{children}</div>;
    }

    if (fallback) {
      return fallback;
    }

    return (
      <ErrorFallback
        errorType={errorType}
        error={error}
        canRetry={canRetry}
        retryCount={retryCount}
        onRetry={this.handleRetry}
        onReset={this.handleReset}
        onOpenSettings={this.openSettings}
        feature={feature}
      />
    );
  }
}