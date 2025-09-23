/**
 * AI Status Zustand store with robust IPC integration.
 *
 * Exposes:
 * - status: current AI availability and provider state
 * - updateStatus(partial): merges partial updates (ensures workingProviders uniqueness)
 * - checkStatus(): debounced manual revalidation via preload bridge (never throws)
 * - requireAI(feature): throws AIUnavailableError when AI unavailable
 * - initIPC(): idempotent IPC subscription setup with HMR-safe cleanup
 *
 * IPC events (via window.ai.aiStatus):
 * - ai-services-status: payload { available, workingProviders, needsConfiguration }
 * - ai-services-degraded: no payload; marks AI unavailable and needs configuration
 * - show-ai-configuration-notice: sets needsConfiguration=true
 *
 * Safety:
 * - No IPC or checkStatus call will throw; errors are logged only.
 * - Module compiles if window.ai is absent (guards and optional chaining).
 */

import { create } from 'zustand';
import type { ProviderName } from '../../services/ai/types';

/**
 * Error thrown when AI usage is required but services are unavailable.
 * name: 'AIUnavailableError'
 * code: 'AI_UNAVAILABLE'
 */
class AIUnavailableError extends Error {
  public readonly code = 'AI_UNAVAILABLE' as const;
  public readonly feature?: string;

  constructor(message: string, feature?: string) {
    super(message);
    this.name = 'AIUnavailableError';
    this.feature = feature;
  }
}

/**
 * Public status snapshot of AI services.
 */
export interface AIStatus {
  available: boolean;
  workingProviders: ProviderName[];
  needsConfiguration: boolean;
  lastChecked: number; // epoch ms
}

/**
 * Store interface with state and actions.
 */
export interface AIStatusStore {
  status: AIStatus;

  /**
   * Merge partial status into current status.
   * - Ensures workingProviders uniqueness when provided.
   * - Will update lastChecked only if provided in the partial.
   *   Note: onStatus/onDegraded events pass lastChecked automatically.
   */
  updateStatus: (status: Partial<AIStatus>) => void;

  /**
   * Debounced manual revalidation.
   * - If called within 1500ms of the last check, resolves early.
   * - Ensures IPC is initialized (idempotent).
   * - Calls window.ai.aiStatus.check(). Errors are logged, never thrown.
   * - Immediately updates lastChecked to request time; detailed status will arrive via onStatus event.
   */
  checkStatus: () => Promise<void>;

  /**
   * Require AI availability for a feature. Throws AIUnavailableError if unavailable.
   * Does not perform any I/O. Synchronous.
   */
  requireAI: (feature: string) => void;

  /**
   * Idempotent subscription to IPC events.
   * Safe to call multiple times. Registers HMR cleanup.
   */
  initIPC: () => void;
}

type IPCStatusPayload = {
  available: boolean;
  workingProviders: ProviderName[];
  needsConfiguration: boolean;
};

// Module-scope guards and unsubscribe registry for HMR-safe lifecycle.
let ipcInitialized = false;
let unsubscribers: Array<() => void> = [];

/**
 * Runtime validation for incoming IPC status payloads.
 */
function isValidIPCStatus(payload: any): payload is IPCStatusPayload {
  if (!payload || typeof payload !== 'object') return false;
  const { available, workingProviders, needsConfiguration } = payload as IPCStatusPayload;
  const providersOk =
    Array.isArray(workingProviders) &&
    workingProviders.every((p) => typeof p === 'string' && p.length > 0);
  return typeof available === 'boolean' && providersOk && typeof needsConfiguration === 'boolean';
}

function uniqueProviders(list: ProviderName[]): ProviderName[] {
  return Array.from(new Set(list));
}

const initialStatus: AIStatus = {
  available: false,
  workingProviders: [],
  needsConfiguration: true,
  lastChecked: 0,
};

/**
 * Zustand store instance.
 */
export const useAIStatusStore = create<AIStatusStore>((set, get) => ({
  status: initialStatus,

  updateStatus: (partial) =>
    set((state) => {
      const next: AIStatus = {
        ...state.status,
        ...partial,
        workingProviders:
          partial.workingProviders !== undefined
            ? uniqueProviders(partial.workingProviders)
            : state.status.workingProviders,
        lastChecked:
          typeof partial.lastChecked === 'number'
            ? partial.lastChecked
            : state.status.lastChecked,
      };
      return { status: next };
    }),

  initIPC: () => {
    if (ipcInitialized) return;

    try {
      const bridge = (window as any)?.ai?.aiStatus;
      if (!bridge) {
        console.warn('[aiStatusStore] window.ai.aiStatus bridge missing; IPC not initialized.');
        ipcInitialized = true; // prevent repeated warnings; still mark to avoid tight loops
        return;
      }

      // onStatus: update with validated payload and current timestamp
      const offStatus = bridge.onStatus((payload: IPCStatusPayload) => {
        try {
          if (!isValidIPCStatus(payload)) {
            console.warn('[aiStatusStore] Ignoring invalid ai-services-status payload:', payload);
            return;
          }
          const now = Date.now();
          get().updateStatus({
            available: payload.available,
            workingProviders: payload.workingProviders,
            needsConfiguration: payload.needsConfiguration,
            lastChecked: now,
          });
        } catch (err) {
          console.error('[aiStatusStore] onStatus handler error:', err);
        }
      });

      // onDegraded: mark unavailable, clear providers, require configuration
      const offDegraded = bridge.onDegraded(() => {
        try {
          const now = Date.now();
          get().updateStatus({
            available: false,
            workingProviders: [],
            needsConfiguration: true,
            lastChecked: now,
          });
        } catch (err) {
          console.error('[aiStatusStore] onDegraded handler error:', err);
        }
      });

      // onConfigurationNotice: set needsConfiguration=true if not already
      const offConfigNotice = bridge.onConfigurationNotice(() => {
        try {
          const current = get().status;
          if (!current.needsConfiguration) {
            get().updateStatus({ needsConfiguration: true });
          }
        } catch (err) {
          console.error('[aiStatusStore] onConfigurationNotice handler error:', err);
        }
      });

      unsubscribers.push(offStatus, offDegraded, offConfigNotice);
      ipcInitialized = true;

      // HMR cleanup
      try {
        (import.meta as any)?.hot?.dispose?.(() => {
          for (const off of unsubscribers) {
            try {
              off();
            } catch {
              // noop
            }
          }
          unsubscribers = [];
          ipcInitialized = false;
        });
      } catch {
        // ignore HMR wiring failures
      }
    } catch (err) {
      console.error('[aiStatusStore] initIPC failed:', err);
      // do not propagate
      ipcInitialized = true; // avoid repeated attempts in tight loops
    }
  },

  checkStatus: async () => {
    // Debounce using lastChecked
    const now = Date.now();
    const last = get().status.lastChecked;
    if (now - last < 1500) {
      return;
    }

    // Ensure IPC initialized
    get().initIPC();

    // Reflect the request time immediately
    set((state) => ({ status: { ...state.status, lastChecked: now } }));

    try {
      const bridge = (window as any)?.ai?.aiStatus;
      await bridge?.check?.();
    } catch (err) {
      console.error('[aiStatusStore] checkStatus error:', err);
      // swallow
    }
  },

  requireAI: (feature: string) => {
    const { available } = get().status;
    if (!available) {
      // Throw only here by design.
      throw new AIUnavailableError(
        `AI services are not available. '${feature}' requires at least one working provider. Open Settings to configure API keys.`,
        feature
      );
    }
  },
}));