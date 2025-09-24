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
import type { AIStatus } from '../../shared/types/ai';
import { toast } from './toastStore';

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

 // AIStatus type imported from ../../shared/types/ai

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

let latestCheckId = 0;

type CheckResult = {
  available: boolean;
  workingProviders: ProviderName[];
  needsConfiguration: boolean;
  lastChecked: number;
};

const MIN_CHECK_DURATION_MS = 500;

function waitForNextIPCResult(bridge: any, timeoutMs = 2000): Promise<CheckResult | null> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (res: CheckResult | null) => {
      if (settled) return;
      settled = true;
      try { offStatus?.(); } catch (e) { void e; }
      try { offDegraded?.(); } catch (e) { void e; }
      if (timer) clearTimeout(timer as unknown as number);
      resolve(res);
    };

    const offStatus = bridge?.onStatus?.((payload: IPCStatusPayload) => {
      try {
        if (!isValidIPCStatus(payload)) {
          console.warn('[aiStatusStore] Ignoring invalid ai-services-status payload (one-shot):', payload);
          return;
        }
        const now = Date.now();
        finish({
          available: payload.available,
          workingProviders: payload.workingProviders,
          needsConfiguration: payload.needsConfiguration,
          lastChecked: now,
        });
      } catch {
        // ignore
      }
    });

    const offDegraded = bridge?.onDegraded?.(() => {
      try {
        const now = Date.now();
        finish({
          available: false,
          workingProviders: [],
          needsConfiguration: true,
          lastChecked: now,
        });
      } catch {
        // ignore
      }
    });

    const timer = timeoutMs > 0 ? setTimeout(() => finish(null), timeoutMs) : undefined;
  });
}

const initialStatus: AIStatus = {
  available: false,
  workingProviders: [],
  needsConfiguration: true,
  lastChecked: 0,
  isChecking: false,
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
          // If a check is currently in progress, defer applying payload.
          const current = get().status;
          if (current.isChecking) {
            // The active check routine will capture and apply the result atomically.
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
          const current = get().status;
          if (current.isChecking) {
            // Defer to active check completion to apply result atomically.
            return;
          }
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

    const requestId = ++latestCheckId;
    const start = now;

    // Atomic start of check
    set((state) => ({
      status: {
        ...state.status,
        isChecking: true,
        lastChecked: start,
      },
    }));

    const bridge = (window as any)?.ai?.aiStatus;
    const resultPromise: Promise<CheckResult | null> = bridge?.check
      ? waitForNextIPCResult(bridge, 2000)
      : Promise.resolve<CheckResult | null>(null);

    // Trigger check immediately but do not await (avoid blocking callers/tests)
    try {
      bridge?.check?.().catch((err: any) => {
        console.error('[aiStatusStore] checkStatus error:', err);
      });
    } catch (err) {
      console.error('[aiStatusStore] checkStatus unexpected error (invoke):', err);
    }

    // Background completion handler to enforce minimum visible duration and atomic finish
    void (async () => {
      let result: CheckResult | null = null;
      try {
        result = await resultPromise;
      } catch {
        result = null;
      }

      // Enforce minimum visible duration
      const elapsed = Date.now() - start;
      if (elapsed < MIN_CHECK_DURATION_MS) {
        await new Promise((r) => setTimeout(r, MIN_CHECK_DURATION_MS - elapsed));
      }

      // Only the latest check may apply completion
      if (requestId !== latestCheckId) {
        return;
      }

      const prev = get().status;
      const next: AIStatus = {
        ...prev,
        isChecking: false,
        available: result?.available ?? prev.available,
        workingProviders: result?.workingProviders ? uniqueProviders(result.workingProviders) : prev.workingProviders,
        needsConfiguration: result?.needsConfiguration ?? prev.needsConfiguration,
        lastChecked: result?.lastChecked ?? Date.now(),
      };

      // Atomic completion of check
      set({ status: next });
    })();
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

// Toast notifications for AI status transitions (guarded to avoid duplicate subscriptions in HMR)
try {
  const g: any = globalThis as any;
  if (!g.__aiStatusToastSub) {
    let prev = useAIStatusStore.getState().status;
    g.__aiStatusToastSub = useAIStatusStore.subscribe((state) => {
      const next = state.status;
      try {
        // Activation transition: available false -> true
        if (!prev.available && next.available) {
          const n = Array.isArray(next.workingProviders) ? next.workingProviders.length : 0;
          if (n > 0) {
            toast.success('AI Services Activated', `${n} provider(s) available`);
          } else {
            toast.success('AI Services Active', 'All features are now available');
          }
        }
        // Degraded/unavailable: available true -> false OR configuration newly required
        else if ((prev.available && !next.available) || (!prev.needsConfiguration && next.needsConfiguration)) {
          toast.warning('AI Services Degraded', 'Some features may be unavailable');
        }
      } catch {
        // ignore toast errors
      } finally {
        prev = next;
      }
    });
  }
} catch {
  // ignore subscription wiring errors
}