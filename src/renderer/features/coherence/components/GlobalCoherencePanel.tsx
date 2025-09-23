import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import { useGlobalCoherenceStore } from '../stores/globalCoherenceStore';
import type {
  GlobalCoherenceSettings,
  GlobalCoherenceProgress,
  GlobalCoherenceAnalysis,
} from '../../../../shared/types';
import { useAIStatusStore } from '../../../stores/aiStatusStore';
import { useSettingsStore } from '../../settings/stores/useSettingsStore';

const PASS_LABELS: Record<GlobalCoherenceProgress['currentPass'], string> = {
  transitions: 'Scene Transitions',
  sequences: 'Sequence Coherence',
  chapters: 'Chapter Flow',
  arc: 'Narrative Arc',
  synthesis: 'Synthesis',
};

function estimateCost(scenes: number, settings: GlobalCoherenceSettings): number {
  let cost = 0;

  if (settings.enableTransitions) {
    cost += Math.max(0, scenes - 1) * 0.002;
  }
  if (settings.enableSequences) {
    cost += Math.max(0, scenes - 4) * 0.005;
  }
  if (settings.enableChapters) {
    cost += Math.ceil(scenes / 10) * 0.01;
  }
  if (settings.enableArc) {
    cost += scenes < 50 ? 0.1 : 0.25;
  }
  if (settings.enableSynthesis) {
    cost += 0.05;
  }

  const depthFactor =
    settings.depth === 'quick' ? 0.5 : settings.depth === 'thorough' ? 1.5 : 1;
  cost *= depthFactor;

  return Math.max(0, cost);
}

function formatUSD(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatETA(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export const GlobalCoherencePanel: React.FC = () => {
  const manuscript = useManuscriptStore((s) => s.manuscript);

  const status = useAIStatusStore((s) => s.status);
  const checkStatus = useAIStatusStore((s) => s.checkStatus);
  const requireAI = useAIStatusStore((s) => s.requireAI);
  const openSettings = useSettingsStore((s) => s.openSettings);

  // Ensure AI status is fresh on mount
  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const {
    isAnalyzing,
    progress,
    lastAnalysis,
    startAnalysis,
    cancelAnalysis,
    settings,
    updateSettings,
  } = useGlobalCoherenceStore();

  const [expanded, setExpanded] = useState(true);
  const toggleExpanded = useCallback(() => setExpanded((e) => !e), []);

  // Local settings mirror with store defaults
  const [localSettings, setLocalSettings] = useState<GlobalCoherenceSettings>(settings);

  useEffect(() => {
    // Sync if store settings change externally
    setLocalSettings((prev) => ({ ...prev, ...settings }));
  }, [settings]);

  const scenesCount = manuscript?.scenes?.length ?? 0;

  const costEstimate = useMemo(
    () => (manuscript ? estimateCost(scenesCount, localSettings) : 0),
    [manuscript, scenesCount, localSettings]
  );

  const handleSettingChange = useCallback(
    (patch: Partial<GlobalCoherenceSettings>) => {
      setLocalSettings((s) => ({ ...s, ...patch }));
      // Reflect defaults into store for future runs
      updateSettings(patch);
    },
    [updateSettings]
  );

  const handleAnalyze = useCallback(async () => {
    if (!manuscript) return;

    if (costEstimate > 1.0) {
      const api = (window as any).electronAPI;
      try {
        // Prefer preload confirm dialog if available; fall back to window.confirm
        const response = await (api?.showConfirmDialog?.(
          'Confirm Analysis Cost',
          `This analysis is estimated to cost approximately ${formatUSD(
            costEstimate
          )}. Do you want to proceed?`
        ) ?? Promise.resolve(undefined));

        if (typeof response === 'boolean') {
          if (!response) return;
        } else {
          const ok = window.confirm(
            `This analysis is estimated to cost approximately ${formatUSD(
              costEstimate
            )}. Do you want to proceed?`
          );
          if (!ok) return;
        }
      } catch {
        const ok = window.confirm(
          `This analysis is estimated to cost approximately ${formatUSD(
            costEstimate
          )}. Do you want to proceed?`
        );
        if (!ok) return;
      }
    }

    try {
      // Enforce AI availability for this feature
      requireAI('Global Coherence Analysis');
      await startAnalysis(manuscript, { ...localSettings });
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
  }, [manuscript, costEstimate, startAnalysis, localSettings, requireAI, checkStatus]);

  const handleCancel = useCallback(() => {
    cancelAnalysis();
  }, [cancelAnalysis]);

  const passLabel = progress ? PASS_LABELS[progress.currentPass] : '';

  const summary = useMemo(() => {
    const a = lastAnalysis;
    if (!a) return null;
    const flow = a.flowIssues?.length ?? 0;
    const pacing = a.pacingProblems?.length ?? 0;
    const theme = a.thematicBreaks?.length ?? 0;
    const arc = a.characterArcDisruptions?.length ?? 0;
    const affected = getAffectedScenesCount(a);
    return {
      flow,
      pacing,
      theme,
      arc,
      affected,
      total: flow + pacing + theme + arc,
    };
  }, [lastAnalysis]);

  // Loading state while AI status is being checked
  if (status.isChecking) {
    return (
      <div className={['rounded-md border border-gray-300 bg-gray-50 p-4'].join(' ')}>
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
        className={['rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900'].join(' ')}
        role="status"
        aria-live="polite"
        title={status.lastChecked ? `Last checked: ${new Date(status.lastChecked).toLocaleString()}` : undefined}
      >
        <div className="mb-2">
          <h3 className="font-semibold text-amber-900">AI Required: Global Coherence Analysis</h3>
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
                  console.warn('[GlobalCoherencePanel] No settings open handler available.');
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
    <div className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex items-center gap-2 text-left"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse Global Coherence panel' : 'Expand Global Coherence panel'}
        >
          <span aria-hidden="true" className="text-gray-600 dark:text-gray-300">
            {expanded ? '▼' : '▶'}
          </span>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Global Coherence
          </h2>
        </button>

        <div className="flex items-center gap-2">
          {!isAnalyzing ? (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!manuscript}
              className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              aria-label={`Analyze global coherence (estimated cost ${formatUSD(costEstimate)})`}
            >
              Analyze ({formatUSD(costEstimate)})
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCancel}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-700"
              aria-label="Cancel global coherence analysis"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-4">
          {/* Settings: Pass selection */}
          <div>
            <div className="text-xs text-gray-700 dark:text-gray-300 font-medium mb-2">Passes</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={localSettings.enableTransitions}
                  onChange={(e) => handleSettingChange({ enableTransitions: e.target.checked })}
                />
                <span>Transitions</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={localSettings.enableSequences}
                  onChange={(e) => handleSettingChange({ enableSequences: e.target.checked })}
                />
                <span>Sequences</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={localSettings.enableChapters}
                  onChange={(e) => handleSettingChange({ enableChapters: e.target.checked })}
                />
                <span>Chapters</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={localSettings.enableArc}
                  onChange={(e) => handleSettingChange({ enableArc: e.target.checked })}
                />
                <span>Narrative Arc</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={localSettings.enableSynthesis}
                  onChange={(e) => handleSettingChange({ enableSynthesis: e.target.checked })}
                />
                <span>Synthesis</span>
              </label>
            </div>
          </div>

          {/* Depth selection */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700 dark:text-gray-300">Depth</label>
            <select
              value={localSettings.depth}
              onChange={(e) =>
                handleSettingChange({ depth: e.target.value as GlobalCoherenceSettings['depth'] })
              }
              className="text-sm border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900"
              aria-label="Select analysis depth"
            >
              <option value="quick">Quick</option>
              <option value="standard">Standard</option>
              <option value="thorough">Thorough</option>
            </select>
          </div>

          {/* Progress UI while analyzing */}
          {isAnalyzing && progress ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
                <div>
                  {passLabel} — Pass {progress.passNumber} / {progress.totalPasses}
                </div>
                <div>
                  {progress.scenesAnalyzed} / {progress.totalScenes} scenes
                </div>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-800 rounded">
                <div
                  className="h-2 bg-indigo-600 rounded"
                  style={{ width: `${Math.max(0, Math.min(100, progress.passProgress))}%` }}
                />
              </div>
              {progress.estimatedTimeRemaining > 0 ? (
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <span aria-hidden="true">🕒</span>
                  <span>ETA: {formatETA(progress.estimatedTimeRemaining)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Results summary alert after completion */}
          {!isAnalyzing && lastAnalysis && summary ? (
            <div
              className="p-3 rounded-md border border-green-200 bg-green-50 text-green-800"
              role="alert"
            >
              <div className="text-sm font-medium mb-1">Global Coherence Summary</div>
              <div className="text-xs space-y-1">
                <div>
                  <span className="font-semibold">{summary.total}</span> issues found across{' '}
                  <span className="font-semibold">{summary.affected}</span> scenes.
                </div>
                <div className="grid grid-cols-2 gap-x-4">
                  <div>Flow issues: <span className="font-semibold">{summary.flow}</span></div>
                  <div>Pacing issues: <span className="font-semibold">{summary.pacing}</span></div>
                  <div>Thematic breaks: <span className="font-semibold">{summary.theme}</span></div>
                  <div>Character arc disruptions: <span className="font-semibold">{summary.arc}</span></div>
                </div>
                <div className="text-[11px] text-green-700 mt-1">
                  Results feed into scene-level issues to inform rewrites and continuity checks.
                </div>
              </div>
            </div>
          ) : null}

          {/* Manuscript not loaded hint */}
          {!manuscript ? (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              Load a manuscript to enable analysis.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

function getAffectedScenesCount(analysis: GlobalCoherenceAnalysis): number {
  const set = new Set<string>();

  // Aggregated issue mappings
  analysis.flowIssues?.forEach((i) => i.affectedScenes?.forEach((id) => set.add(id)));
  analysis.pacingProblems?.forEach((i) => i.affectedScenes?.forEach((id) => set.add(id)));
  analysis.characterArcDisruptions?.forEach((i) => i.affectedScenes?.forEach((id) => set.add(id)));

  analysis.thematicBreaks?.forEach((t) => {
    if (t.lastSeenScene) set.add(t.lastSeenScene);
    if (t.brokenAtScene) set.add(t.brokenAtScene);
  });

  // Scene pair analyses (transitions)
  analysis.sceneLevel?.forEach((p) => {
    if (p.sceneAId) set.add(p.sceneAId);
    if (p.sceneBId) set.add(p.sceneBId);
  });

  // Chapter analyses
  analysis.chapterLevel?.forEach((c) => {
    c.sceneIds?.forEach((id) => set.add(id));
  });

  return set.size;
}

export default GlobalCoherencePanel;