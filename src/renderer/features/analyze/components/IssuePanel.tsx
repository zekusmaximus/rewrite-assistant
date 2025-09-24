import React, { useCallback, useMemo, useEffect } from 'react';
import type { ContinuityIssue } from '../../../../shared/types';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useAnalysis from '../hooks/useAnalysis';
import AnalysisProgress from './AnalysisProgress';
import IssueItem from './IssueItem';
import { useAIStatusStore } from '../../../stores/aiStatusStore';
import { useSettingsStore } from '../../settings/stores/useSettingsStore';

export interface IssuePanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
  onShowInScene?: (sceneId: string, issue: ContinuityIssue) => void;
}

type IssueKind = 'pronoun' | 'timeline' | 'character' | 'plot' | 'engagement';

const TYPE_LABELS: Record<IssueKind, string> = {
  pronoun: 'Pronoun',
  timeline: 'Timeline',
  character: 'Character',
  plot: 'Plot',
  engagement: 'Engagement',
} as const;

function IssuePanel(props: IssuePanelProps) {
  const { isOpen = true, onClose, className, onShowInScene } = props;

  const status = useAIStatusStore((s) => s.status);
  const checkStatus = useAIStatusStore((s) => s.checkStatus);
  const requireAI = useAIStatusStore((s) => s.requireAI);
  const openSettings = useSettingsStore((s) => s.openSettings);
  
  const manuscript = useManuscriptStore((s) => s.manuscript);

  // Ensure AI status is fresh when the panel opens
  useEffect(() => {
    if (isOpen) {
      void checkStatus();
    }
  }, [isOpen, checkStatus]);

  const {
    analyzeMovedScenes,
    getSceneIssues,
    getIssueCountsByType,
    clearIssues,
    toggleIssueType,
    isAnalyzing,
    progress,
    selectedIssueTypes,
  } = useAnalysis();


  // Moved scenes (ids and map for context)
  const movedScenes = useMemo(() => {
    const scenes = manuscript?.scenes ?? [];
    return scenes.filter((s) => s.hasBeenMoved === true);
  }, [manuscript]);

  const movedSceneIds = useMemo(() => movedScenes.map((s) => s.id), [movedScenes]);

  // Counts by type (respects selectedIssueTypes inside hook implementation)
  const counts = useMemo(() => getIssueCountsByType(movedSceneIds), [getIssueCountsByType, movedSceneIds]);

  // Flat list of issues across moved scenes (grouping optional per subtask; provide scene metadata to items)
  const flatIssues = useMemo(() => {
    const items: Array<{ sceneId: string; issue: ContinuityIssue; sceneTitle?: string; scenePosition?: number }> = [];
    for (const scene of movedScenes) {
      const sceneIssues = getSceneIssues(scene.id);
      if (!sceneIssues || sceneIssues.length === 0) continue;
      for (const issue of sceneIssues) {
        items.push({
          sceneId: scene.id,
          issue,
          // Title/name may not exist on Scene type; fall back to id. Position is available.
          sceneTitle: (scene as unknown as { title?: string; name?: string }).title ?? (scene as unknown as { title?: string; name?: string }).name ?? scene.id,
          scenePosition: scene.position,
        });
      }
    }
    return items;
  }, [movedScenes, getSceneIssues]);

  const totalFilteredIssues = useMemo(
    () => Object.values(counts).reduce((acc, n) => acc + n, 0),
    [counts]
  );

  const handleToggle = useCallback(
    (type: IssueKind) => {
      toggleIssueType(type);
    },
    [toggleIssueType]
  );

  const handleAnalyze = useCallback(async () => {
    try {
      // Enforce AI availability for this feature
      requireAI('Continuity Analysis');
      await analyzeMovedScenes();
    } catch (error) {
      const err = error as unknown;
      const code = (err as any)?.code as string | undefined;
      const name = (err as Error | undefined)?.name;
      if (code === 'AI_UNAVAILABLE' || name === 'AIUnavailableError') {
        // Refresh status; UI will switch to configuration prompt if unavailable
        await checkStatus();
        return;
      }
      // Preserve existing behavior: rethrow for unexpected errors
      throw error;
    }
  }, [analyzeMovedScenes, requireAI, checkStatus]);

  const handleShowInScene = useCallback(
    (issue: ContinuityIssue, sceneId: string) => {
      if (onShowInScene) onShowInScene(sceneId, issue);
    },
    [onShowInScene]
  );

  const handleDismissIssue = useCallback(
    (issue: ContinuityIssue, sceneId: string) => {
      // Subtask scope: simple dismissal clears all issues for the scene.
      clearIssues(sceneId);
    },
    [clearIssues]
  );

  const Pill = ({ type }: { type: IssueKind }) => {
    const active = selectedIssueTypes.has(type);
    const count = counts[type] ?? 0;
    return (
      <button
        type="button"
        onClick={() => handleToggle(type)}
        className={[
          'text-xs px-2 py-1 rounded-full border transition',
          active
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white/60 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
        ].join(' ')}
        aria-pressed={active}
        aria-label={`${TYPE_LABELS[type]} issues`}
      >
        <span>{TYPE_LABELS[type]}</span>
        <span
          className={[
            'ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full',
            active ? 'bg-white/20 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
          ].join(' ')}
        >
          {count}
        </span>
      </button>
    );
  };

  // Guard return after all hooks are declared to satisfy rules-of-hooks
  if (!isOpen) {
    return <div className={className} />;
  }

  // Guard return after all hooks to keep hooks order stable
  if (!isOpen) {
    return <div className={className} />;
  }

  // Loading state while AI status is being checked
  if (status.isChecking) {
    return (
      <div 
        className={['rounded-md border border-gray-300 bg-gray-50 p-4', className].filter(Boolean).join(' ')}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-gray-400 border-t-transparent rounded-full" />
          <div>
            <div className="font-semibold text-gray-900">Checking AI Services...</div>
            <div className="text-sm text-gray-600 mt-1">Verifying API keys and provider availability</div>
          </div>
        </div>
      </div>
    );
  }

  // Block all analysis functionality when AI is unavailable
  if (!status.isChecking && !status.available) {
    return (
      <div
        className={['rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900', className].filter(Boolean).join(' ')}
        role="status"
        aria-live="polite"
        title={status.lastChecked ? `Last checked: ${new Date(status.lastChecked).toLocaleString()}` : undefined}
      >
        <div className="mb-2">
          <h3 className="font-semibold text-amber-900">AI Required: Continuity Analysis</h3>
        </div>
        <p className="mb-3">This feature needs at least one working AI provider. Add or fix your API keys in Settings.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (typeof openSettings === 'function') {
                openSettings();
              } else {
                const storeAny = useSettingsStore as unknown as { getState?: () => any };
                const state = storeAny?.getState?.();
                if (typeof state?.setIsOpen === 'function') {
                  state.setIsOpen(true);
                } else if (typeof state?.setIsSettingsOpen === 'function') {
                  state.setIsSettingsOpen(true);
                } else {
                  console.warn('[IssuePanel] No settings open handler available.');
                }
              }
            }}
            className="text-amber-800 underline decoration-amber-400 hover:text-amber-900"
            aria-label="Open Settings"
          >
            Open Settings
          </button>
          <button
            type="button"
            onClick={() => { void checkStatus(); }}
            className="px-2 py-1 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
            aria-label="Refresh AI status"
          >
            Refresh Status
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={['w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40', className].filter(Boolean).join(' ')}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Issues Found in Moved Scenes</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAnalyze}
            className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition"
          >
            Analyze Moved Scenes
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              aria-label="Close issues panel"
              title="Close"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      {/* Progress */}
      <div className="p-3">
        <AnalysisProgress isAnalyzing={isAnalyzing} progress={progress} />
      </div>

      {/* Filters */}
      <div className="px-3 pb-2">
        <div className="flex flex-wrap gap-2">
          {(['pronoun', 'timeline', 'character', 'plot', 'engagement'] as IssueKind[]).map((t) => (
            <Pill key={t} type={t} />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="p-3">
        {totalFilteredIssues === 0 && !isAnalyzing && progress?.total > 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-300">No issues found in moved scenes</div>
        ) : (
          <div className="flex flex-col gap-3">
            {flatIssues.map(({ sceneId, issue, sceneTitle, scenePosition }) => (
              <IssueItem
                key={`${sceneId}-${issue.type}-${issue.textSpan?.[0] ?? 0}-${issue.textSpan?.[1] ?? 0}-${issue.description}`}
                issue={issue}
                sceneId={sceneId}
                sceneTitle={sceneTitle}
                scenePosition={scenePosition}
                onShowInScene={handleShowInScene}
                onDismiss={handleDismissIssue}
              />
            ))}
            {flatIssues.length === 0 && isAnalyzing ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">Analyzing moved scenes…</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default IssuePanel;