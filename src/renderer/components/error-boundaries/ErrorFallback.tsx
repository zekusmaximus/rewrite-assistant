import React from 'react';
import type { ErrorType } from './errorClassification';
import { toast } from '../../stores/toastStore';
import { useSettingsStore } from '../../features/settings/stores/useSettingsStore';

export interface ErrorFallbackProps {
  errorType: ErrorType;
  error: Error | null;
  canRetry: boolean;
  retryCount: number;
  onRetry: () => void;
  onReset: () => void;
  onOpenSettings: () => void;
  feature?: string;
}

function makeErrorSummary(feature: string | undefined, error: Error | null): string {
  const name = error?.name ?? 'Error';
  const msg = error?.message ?? '(no message)';
  return `[${feature ?? 'unknown-feature'}] ${name}: ${msg}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    try {
      // Fallback approach
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  errorType,
  error,
  canRetry,
  retryCount,
  onRetry,
  onReset,
  onOpenSettings,
  feature,
}) => {
  // Guard: ensure we have a way to open settings even if caller omitted onOpenSettings
  const openSettingsImperative = React.useMemo(() => {
    if (typeof onOpenSettings === 'function') return onOpenSettings;
    // Fallback to Zustand store imperative API (safe for non-hook usage)
    return () => {
      try {
        const fn = useSettingsStore.getState().openSettings;
        if (typeof fn === 'function') fn();
      } catch {
        // no-op
      }
    };
  }, [onOpenSettings]);

  const reportIssue = React.useCallback(() => {
    const summary = makeErrorSummary(feature, error);
    // Push a toast with an action to copy details
    toast.addToast({
      type: 'info',
      title: 'Report Issue',
      message: 'Copy error details and share in your bug report',
      action: {
        label: 'Copy details',
        onClick: async () => {
          const ok = await copyToClipboard(summary);
          if (ok) {
            toast.info('Copied', 'Error details copied to clipboard');
          } else {
            toast.warning('Copy Failed', 'Unable to copy error details');
          }
        },
      },
    });
  }, [feature, error]);

  // Panel variants
  if (errorType === 'key') {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800">
        <div className="mb-2">
          <h3 className="font-semibold text-red-900">API Configuration Required</h3>
        </div>
        <p className="mb-3 text-red-700">
          This feature requires a valid API key. Open Settings to add or fix your key(s).
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openSettingsImperative}
            className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            Open Settings
          </button>
          {error?.message ? (
            <span className="text-xs text-red-700">{error.message}</span>
          ) : null}
        </div>
      </div>
    );
  }

  if (errorType === 'network') {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <div className="mb-2">
          <h3 className="font-semibold text-amber-900">Connection Issue</h3>
        </div>
        <p className="mb-3 text-amber-700">
          We are having trouble reaching the AI service. Please check your connection and try again.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={!canRetry}
            className="px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Retry
          </button>
          {retryCount > 0 ? (
            <span className="text-xs text-amber-700">Attempts: {retryCount} / 3</span>
          ) : null}
        </div>
      </div>
    );
  }

  if (errorType === 'service') {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-gray-900">
        <div className="mb-2">
          <h3 className="font-semibold text-gray-900">Service Temporarily Unavailable</h3>
        </div>
        <p className="mb-3 text-gray-700">
          The AI provider is temporarily unavailable or rate-limited. You can retry or reset the panel.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={!canRetry}
            className="px-3 py-1.5 rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-100"
          >
            Reset
          </button>
        </div>
        {error?.message ? (
          <div className="text-xs text-gray-600 mt-2">{error.message}</div>
        ) : null}
      </div>
    );
  }

  // Unknown
  return (
    <div className="rounded-md border border-gray-300 bg-white p-4 text-gray-900">
      <div className="mb-2">
        <h3 className="font-semibold text-gray-900">Something went wrong</h3>
      </div>
      <p className="mb-3 text-gray-700">
        An unexpected error occurred. You can reset the panel or report the issue.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-100"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={reportIssue}
          className="px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-black"
        >
          Report Issue
        </button>
      </div>
      {error?.message ? (
        <div className="text-xs text-gray-600 mt-2">{error.message}</div>
      ) : null}
    </div>
  );
};

export default ErrorFallback;