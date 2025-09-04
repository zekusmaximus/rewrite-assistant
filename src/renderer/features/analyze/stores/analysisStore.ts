import { create } from 'zustand';
import type { ContinuityAnalysis, Scene, Manuscript } from '../../../../shared/types';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import ContinuityAnalyzer from '../services/ContinuityAnalyzer';
import AIServiceManager from '../../../../services/ai/AIServiceManager';

/**
 * Local analysis stage indicator for UI and orchestration.
 */
export type AnalysisStage = 'detecting' | 'ai-validation' | 'finalizing';

/**
 * Local analysis options settable by callers.
 */
export interface AnalysisOptions {
  includeEngagement: boolean;
  autoAnalyze: boolean;
}

/**
 * Narrow type for selectable issue filters in UI.
 */
export type IssueFilter =
  | 'pronoun'
  | 'timeline'
  | 'character'
  | 'plot'
  | 'engagement';

interface AnalysisProgress {
  current: number;
  total: number;
  stage: AnalysisStage;
}

interface AnalysisState {
  // State
  isAnalyzing: boolean;
  currentScene?: string;
  progress: AnalysisProgress;
  analyses: Map<string, ContinuityAnalysis>;
  selectedIssueTypes: Set<IssueFilter>;
  analysisOptions: AnalysisOptions;

  // Actions
  /**
   * Analyze all scenes that have been moved, updating progress along the way.
   * - Reads moved scenes from manuscript store (hasBeenMoved === true).
   * - Leaves existing analyses intact; updates/overwrites per scene.
   */
  analyzeMovedScenes: () => Promise<void>;

  /**
   * Analyze a single scene by ID, using current analysis options.
   * - Uses local ContinuityAnalyzer with AIServiceManager (renderer-side) by default.
   * - Updates analyses map immutably on success.
   * - Swallows errors with console.error; state ends in 'finalizing'.
   */
  analyzeScene: (sceneId: string) => Promise<void>;

  /**
   * Clear issues either for a specific sceneId, or all analyses when no ID passed.
   * Updates the analyses Map immutably.
   */
  clearIssues: (sceneId?: string) => void;

  /**
   * Toggle an issue type filter (pronoun/timeline/character/plot/engagement) immutably.
   */
  toggleIssueType: (type: IssueFilter) => void;

  /**
   * Merge partial options into analysisOptions immutably.
   */
  setAnalysisOptions: (options: Partial<AnalysisOptions>) => void;
}

// Singleton analyzer + AI manager for renderer store usage.
const aiManager = new AIServiceManager();
const analyzer = new ContinuityAnalyzer({ enableCache: true });

/**
 * Helper: derive previous scenes (in current order) before a given sceneId.
 */
function getPreviousScenes(manuscript: Manuscript, sceneId: string): Scene[] {
  const order = manuscript.currentOrder ?? manuscript.scenes.map(s => s.id);
  const idx = order.indexOf(sceneId);
  if (idx <= 0) return [];
  const prevIds = order.slice(0, idx);
  const byId = new Map(manuscript.scenes.map(s => [s.id, s] as const));
  const prev: Scene[] = [];
  for (const id of prevIds) {
    const s = byId.get(id);
    if (s) prev.push(s);
  }
  return prev;
}

/**
 * Helper: immutable Map set
 */
function mapWith<K, V>(src: Map<K, V>, k: K, v: V): Map<K, V> {
  const next = new Map(src);
  next.set(k, v);
  return next;
}

/**
 * Helper: immutable Map delete
 */
function mapWithout<K, V>(src: Map<K, V>, k: K): Map<K, V> {
  const next = new Map(src);
  next.delete(k);
  return next;
}

const defaultSelectedFilters: IssueFilter[] = [
  'pronoun',
  'timeline',
  'character',
  'plot',
  'engagement',
];

const initialState: Pick<
  AnalysisState,
  | 'isAnalyzing'
  | 'currentScene'
  | 'progress'
  | 'analyses'
  | 'selectedIssueTypes'
  | 'analysisOptions'
> = {
  isAnalyzing: false,
  currentScene: undefined,
  progress: { current: 0, total: 0, stage: 'detecting' },
  analyses: new Map<string, ContinuityAnalysis>(),
  selectedIssueTypes: new Set<IssueFilter>(defaultSelectedFilters),
  analysisOptions: { includeEngagement: true, autoAnalyze: true },
};

const useAnalysisStore = create<AnalysisState>((set, get) => ({
  ...initialState,

  /**
   * Analyze scenes that have hasBeenMoved === true in the manuscript.
   * Initializes progress and runs analyses sequentially.
   */
  async analyzeMovedScenes(): Promise<void> {
    const ms = useManuscriptStore.getState().manuscript;
    const moved = (ms?.scenes ?? []).filter((s) => s.hasBeenMoved === true);

    if (!ms || moved.length === 0) {
      // No-op but ensure isAnalyzing false
      set((state) => ({
        ...state,
        isAnalyzing: false,
      }));
      return;
    }

    // Initialize batch progress
    set((state) => ({
      ...state,
      isAnalyzing: true,
      progress: {
        current: 0,
        total: moved.length,
        stage: 'detecting',
      },
    }));

    for (let i = 0; i < moved.length; i++) {
      const scene = moved[i];
      // Delegate to single-scene analyze
      await get().analyzeScene(scene.id);

      // Increment progress current after each scene
      set((state) => ({
        ...state,
        progress: {
          ...state.progress,
          current: Math.min(state.progress.current + 1, state.progress.total),
        },
      }));
    }

    // Finalize batch
    set((state) => ({
      ...state,
      isAnalyzing: false,
      currentScene: undefined,
      progress: {
        ...state.progress,
        stage: 'finalizing',
      },
    }));
  },

  /**
   * Analyze a specific scene by ID using ContinuityAnalyzer.
   * Uses previous scenes from current manuscript order.
   */
  async analyzeScene(sceneId: string): Promise<void> {
    // Begin detection stage
    set((state) => ({
      ...state,
      isAnalyzing: true,
      currentScene: sceneId,
      progress: { ...state.progress, stage: 'detecting' },
    }));

    try {
      const ms = useManuscriptStore.getState().manuscript;
      if (!ms) {
        console.error('[analysisStore] No manuscript loaded; cannot analyze.');
        set((state) => ({
          ...state,
          isAnalyzing: false,
          progress: { ...state.progress, stage: 'finalizing' },
        }));
        return;
      }

      const scene =
        useManuscriptStore.getState().getSceneById(sceneId) ??
        ms.scenes.find((s) => s.id === sceneId) ??
        null;

      if (!scene) {
        console.error('[analysisStore] Scene not found:', sceneId);
        set((state) => ({
          ...state,
          isAnalyzing: false,
          progress: { ...state.progress, stage: 'finalizing' },
        }));
        return;
      }

      const prevScenes = getPreviousScenes(ms, sceneId);

      // Transition into AI validation stage
      set((state) => ({
        ...state,
        progress: { ...state.progress, stage: 'ai-validation' },
      }));

      // Prefer IPC if exposed in preload; fallback to local service.
      // Note: current preload exposes no analysis APIs; using local analyzer.
      const { includeEngagement } = get().analysisOptions;
      const result = await analyzer.analyzeScene(
        scene,
        prevScenes,
        aiManager,
        { includeEngagement }
      );

      // Update analyses immutably
      set((state) => ({
        ...state,
        analyses: mapWith(state.analyses, sceneId, result),
        progress: { ...state.progress, stage: 'finalizing' },
      }));
    } catch (err) {
      console.error('[analysisStore] analyzeScene failed:', err);
      set((state) => ({
        ...state,
        isAnalyzing: false,
        progress: { ...state.progress, stage: 'finalizing' },
      }));
      return;
    } finally {
      // Ensure correct analyzing flag based on whether we're in a batch
      set((state) => {
        const inBatch =
          state.progress.total > 0 &&
          state.progress.current < state.progress.total;
        return {
          ...state,
          isAnalyzing: inBatch ? true : false,
          currentScene: undefined,
        };
      });
    }
  },

  /**
   * Clear issues for a specific scene or all scenes.
   */
  clearIssues(sceneId?: string): void {
    set((state) => {
      if (!sceneId) {
        return { ...state, analyses: new Map<string, ContinuityAnalysis>() };
      }
      return {
        ...state,
        analyses: mapWithout(state.analyses, sceneId),
      };
    });
  },

  /**
   * Toggle a specific issue filter flag immutably.
   */
  toggleIssueType(type: IssueFilter): void {
    set((state) => {
      const next = new Set(state.selectedIssueTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...state, selectedIssueTypes: next };
    });
  },

  /**
   * Merge partial analysis options.
   */
  setAnalysisOptions(options: Partial<AnalysisOptions>): void {
    set((state) => ({
      ...state,
      analysisOptions: { ...state.analysisOptions, ...options },
    }));
  },
}));

export default useAnalysisStore;