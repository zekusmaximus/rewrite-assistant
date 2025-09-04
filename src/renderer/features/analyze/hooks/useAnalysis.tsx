import { useMemo, useCallback } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useAnalysisStore, {
  type AnalysisOptions,
  type AnalysisStage,
  type IssueFilter,
} from '../stores/analysisStore';
import type { ContinuityIssue, ContinuityAnalysis } from '../../../../shared/types';

/**
 * useAnalysis()
 * Composes manuscript and analysis stores and exposes analysis utilities focused on issue identification.
 * No UI side-effects; strictly data/actions. Vision terms: Issues, Find issues, Fix/Rewrite guidance (comments only).
 */
export default function useAnalysis() {
  // Manuscript state
  const manuscript = useManuscriptStore((s) => s.manuscript);

  // Analysis store state
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);
  const progress = useAnalysisStore((s) => s.progress);
  const analyses = useAnalysisStore((s) => s.analyses);
  const selectedIssueTypes = useAnalysisStore((s) => s.selectedIssueTypes);
  const analysisOptions = useAnalysisStore((s) => s.analysisOptions);

  // Analysis store actions
  const storeAnalyzeMovedScenes = useAnalysisStore((s) => s.analyzeMovedScenes);
  const storeAnalyzeScene = useAnalysisStore((s) => s.analyzeScene);
  const storeClearIssues = useAnalysisStore((s) => s.clearIssues);
  const storeToggleIssueType = useAnalysisStore((s) => s.toggleIssueType);
  const storeSetAnalysisOptions = useAnalysisStore((s) => s.setAnalysisOptions);

  /**
   * analyzeMovedScenes()
   * Identify moved scenes from manuscript (hasBeenMoved === true).
   * If none, return early without invoking store.analyzeMovedScenes().
   * If some, call analysisStore.analyzeMovedScenes().
   */
  const analyzeMovedScenes = useCallback(async (): Promise<void> => {
    const movedCount =
      manuscript?.scenes?.reduce((acc, s) => (s.hasBeenMoved === true ? acc + 1 : acc), 0) ?? 0;

    if (movedCount === 0) {
      // Early exit: no moved scenes, do not trigger store analysis
      return;
    }
    await storeAnalyzeMovedScenes();
  }, [manuscript, storeAnalyzeMovedScenes]);

  /**
   * analyzeScene(sceneId)
   * Proxy to store.analyzeScene(sceneId)
   */
  const analyzeScene = useCallback(
    async (sceneId: string): Promise<void> => {
      await storeAnalyzeScene(sceneId);
    },
    [storeAnalyzeScene]
  );

  /**
   * getSceneIssues(sceneId)
   * Filter scene issues by currently selected issue types.
   * Returns [] if scene has no analysis or issues.
   */
  const getSceneIssues = useCallback(
    (sceneId: string): ContinuityIssue[] => {
      const analysis: ContinuityAnalysis | undefined = analyses.get(sceneId);
      if (!analysis || !analysis.issues || analysis.issues.length === 0) return [];

      // Only include selected types
      const issues = analysis.issues.filter((issue) => selectedIssueTypes.has(issue.type as IssueFilter));
      return issues;
    },
    [analyses, selectedIssueTypes]
  );

  /**
   * getIssueCountsByType(sceneIds?)
   * Tally counts by type across analyses (restricted to sceneIds if provided).
   * Counts reflect current selectedIssueTypes.
   */
  const getIssueCountsByType = useCallback(
    (sceneIds?: string[]): Record<'pronoun' | 'timeline' | 'character' | 'plot' | 'engagement', number> => {
      const initial: Record<'pronoun' | 'timeline' | 'character' | 'plot' | 'engagement', number> = {
        pronoun: 0,
        timeline: 0,
        character: 0,
        plot: 0,
        engagement: 0,
      };

      const idSet = sceneIds ? new Set(sceneIds) : null;

      for (const [sceneId, analysis] of analyses.entries()) {
        if (idSet && !idSet.has(sceneId)) continue;
        if (!analysis.issues) continue;

        for (const issue of analysis.issues) {
          // Respect selectedIssueTypes
          if (!selectedIssueTypes.has(issue.type as IssueFilter)) continue;

          // Only count supported types (exclude 'context' or any other)
          switch (issue.type) {
            case 'pronoun':
            case 'timeline':
            case 'character':
            case 'plot':
            case 'engagement':
              initial[issue.type] += 1;
              break;
            default:
              // Ignore any non-selectable types
              break;
          }
        }
      }

      return initial;
    },
    [analyses, selectedIssueTypes]
  );

  /**
   * clearIssues(sceneId?)
   * Proxy to store.clearIssues
   */
  const clearIssues = useCallback(
    (sceneId?: string): void => {
      storeClearIssues(sceneId);
    },
    [storeClearIssues]
  );

  /**
   * toggleIssueType(type)
   * Proxy to store.toggleIssueType
   */
  const toggleIssueType = useCallback(
    (type: 'pronoun' | 'timeline' | 'character' | 'plot' | 'engagement'): void => {
      storeToggleIssueType(type);
    },
    [storeToggleIssueType]
  );

  /**
   * setAnalysisOptions(options)
   * Proxy to store.setAnalysisOptions
   */
  const setAnalysisOptions = useCallback(
    (options: Partial<AnalysisOptions>): void => {
      storeSetAnalysisOptions(options);
    },
    [storeSetAnalysisOptions]
  );

  // Memoize pass-through state to keep stable referential identity where possible
  const memoState = useMemo(
    () => ({
      isAnalyzing,
      progress: progress as { current: number; total: number; stage: AnalysisStage },
      selectedIssueTypes,
      analysisOptions,
    }),
    [isAnalyzing, progress, selectedIssueTypes, analysisOptions]
  );

  return {
    // Actions
    analyzeMovedScenes,
    analyzeScene,
    getSceneIssues,
    getIssueCountsByType,
    clearIssues,
    toggleIssueType,
    setAnalysisOptions,

    // State (pass-through for UI binding)
    ...memoState,
  };
}