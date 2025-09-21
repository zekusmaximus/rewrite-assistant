import { create } from 'zustand';
import type {
  Manuscript,
  GlobalCoherenceSettings,
  GlobalCoherenceProgress,
  GlobalCoherenceAnalysis,
} from '../../../../shared/types';

type Unsub = (() => void) | null;

interface GlobalCoherenceStore {
  isAnalyzing: boolean;
  analysisId: string | null;
  progress: GlobalCoherenceProgress | null;
  lastAnalysis: GlobalCoherenceAnalysis | null;
  error: string | null;
  settings: GlobalCoherenceSettings;
  /** Start a new global coherence analysis. No-op if already analyzing. */
  startAnalysis: (manuscript: Manuscript, overrides?: Partial<GlobalCoherenceSettings>) => Promise<void>;
  /** Cancel the in-flight analysis, if any. */
  cancelAnalysis: () => void;
  /** Update default analysis settings. */
  updateSettings: (update: Partial<GlobalCoherenceSettings>) => void;
  /** Load the last completed analysis from main process. */
  loadLastAnalysis: () => Promise<void>;
}

let unsubProgress: Unsub = null;
let unsubComplete: Unsub = null;
let unsubError: Unsub = null;

function cleanupSubscriptions(): void {
  try { unsubProgress?.(); } catch { /* noop */ }
  try { unsubComplete?.(); } catch { /* noop */ }
  try { unsubError?.(); } catch { /* noop */ }
  unsubProgress = null;
  unsubComplete = null;
  unsubError = null;
}

const defaultSettings: GlobalCoherenceSettings = {
  enableTransitions: true,
  enableSequences: true,
  enableChapters: true,
  enableArc: true,
  enableSynthesis: true,
  depth: 'standard',
};

export const useGlobalCoherenceStore = create<GlobalCoherenceStore>((set, get) => ({
  isAnalyzing: false,
  analysisId: null,
  progress: null,
  lastAnalysis: null,
  error: null,
  settings: defaultSettings,

  /** Update default settings used for future analyses. */
  updateSettings: (update) => {
    set((state) => ({ settings: { ...state.settings, ...update } }));
  },

  /** Start analysis with current settings merged with overrides. Registers IPC listeners before invoking start. */
  startAnalysis: async (manuscript, overrides) => {
    if (get().isAnalyzing) return;

    const settings = { ...get().settings, ...(overrides ?? {}) };
    set({ isAnalyzing: true, progress: null, error: null });

    // Ensure no duplicate listeners
    cleanupSubscriptions();

    // Subscribe to progress/complete/error BEFORE starting
    unsubProgress = window.electronAPI.globalCoherence.onProgress((p) => {
      if ((p as any)?.cancelled) {
        set({ isAnalyzing: false, analysisId: null, progress: null });
        cleanupSubscriptions();
        return;
      }
      const currentId = get().analysisId ?? (p as any).analysisId ?? null;
      set({ progress: p as GlobalCoherenceProgress, analysisId: currentId });
    });

    unsubComplete = window.electronAPI.globalCoherence.onComplete(({ analysis }) => {
      set({ lastAnalysis: analysis, isAnalyzing: false, analysisId: null, progress: null });
      cleanupSubscriptions();
    });

    unsubError = window.electronAPI.globalCoherence.onError(({ error }) => {
      set({ error: error ?? 'Analysis failed', isAnalyzing: false, analysisId: null });
      cleanupSubscriptions();
    });

    try {
      const res = await window.electronAPI.globalCoherence.start(manuscript, settings);
      if (!res?.success) {
        set({ error: res?.error ?? 'Failed to start analysis', isAnalyzing: false, analysisId: null });
        cleanupSubscriptions();
        return;
      }
      set({ analysisId: res.analysisId ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start analysis';
      set({ error: message, isAnalyzing: false, analysisId: null });
      cleanupSubscriptions();
    }
  },

  /** Request cancellation and optimistically stop local state. */
  cancelAnalysis: () => {
    try {
      window.electronAPI.globalCoherence.cancel();
    } catch {
      // swallow
    } finally {
      set({ isAnalyzing: false });
      cleanupSubscriptions();
    }
  },

  /** Load the last completed analysis from main process. */
  loadLastAnalysis: async () => {
    try {
      const last = await window.electronAPI.globalCoherence.getLastAnalysis();
      set({ lastAnalysis: last ?? null });
    } catch {
      // ignore
    }
  },
}));

// Optional export for tests or external cleanup on app-level teardown
export { cleanupSubscriptions };