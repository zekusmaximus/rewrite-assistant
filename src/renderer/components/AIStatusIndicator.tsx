import React from 'react';
import { useAIStatusStore } from '../stores/aiStatusStore';
import { useSettingsStore } from '../features/settings/stores/useSettingsStore';

/**
 * AIStatusIndicator
 *
 * Accessible, minimal indicator of AI service availability.
 * - Reads the AI status snapshot from useAIStatusStore (no IPC or side-effects).
 * - When AI is unavailable, shows an inline "Configure" control that opens the Settings modal.
 *   Opening is performed defensively:
 *     1) If useSettingsStore exposes openSettings(), it is invoked.
 *     2) Else if a setIsOpen(boolean) setter exists, it is called with true.
 *     3) Else, a warning is logged and no-op is performed.
 * - Includes role="status" and aria-live="polite" so assistive tech is informed.
 * - Color is not the sole indicator; clear text labels are used ("AI Services Active/Required").
 * - Uses Tailwind for styling and maintains a compact inline footprint.
 */
const AIStatusIndicator: React.FC = () => {
  const { available, lastChecked } = useAIStatusStore((s) => s.status);
  const settingsState = useSettingsStore();

  const handleConfigureClick = React.useCallback(() => {
    try {
      const anyStore = settingsState as unknown as Record<string, any>;
      if (typeof anyStore.openSettings === 'function') {
        anyStore.openSettings();
      } else if (typeof anyStore.setIsOpen === 'function') {
        anyStore.setIsOpen(true);
      } else {
        console.warn('[AIStatusIndicator] No settings opener available on store.');
      }
    } catch (err) {
      console.warn('[AIStatusIndicator] Failed to open Settings:', err);
    }
  }, [settingsState]);

  const statusText = available ? 'AI Services Active' : 'AI Services Required';
  const title =
    typeof lastChecked === 'number' && lastChecked > 0
      ? `Last checked: ${new Date(lastChecked).toLocaleString()}`
      : undefined;
  const srChecked =
    typeof lastChecked === 'number' && lastChecked > 0
      ? `Last checked ${formatTimeSince(lastChecked)} ago`
      : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 text-sm align-middle"
      title={title}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${available ? 'bg-green-500' : 'bg-amber-500'}`}
      />
      <span>{statusText}</span>
      {srChecked ? <span className="sr-only">{srChecked}</span> : null}
      {!available ? (
        <button
          type="button"
          onClick={handleConfigureClick}
          aria-label="Configure AI services"
          className="ml-1 text-amber-700 hover:text-amber-800 underline decoration-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 rounded-sm"
          title="Open Settings to configure AI providers"
        >
          Configure
        </button>
      ) : null}
    </div>
  );
};

export default AIStatusIndicator;

// ---- utils ----
function formatTimeSince(ts: number): string {
  const diff = Date.now() - ts;
  if (diff <= 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}