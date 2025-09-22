import React, { useMemo } from 'react';
import { useGlobalCoherenceStore } from '../stores/globalCoherenceStore';

const PASS_LABELS: Record<'transitions' | 'sequences' | 'chapters' | 'arc' | 'synthesis', string> = {
  transitions: 'Scene Transitions',
  sequences: 'Sequence Coherence',
  chapters: 'Chapter Flow',
  arc: 'Narrative Arc',
  synthesis: 'Synthesis',
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

const GlobalCoherenceProgress: React.FC = () => {
  const isAnalyzing = useGlobalCoherenceStore((s) => s.isAnalyzing);
  const progress = useGlobalCoherenceStore((s) => s.progress);
  const cancel = useGlobalCoherenceStore((s) => s.cancelAnalysis);

  const show = isAnalyzing || !!progress;

  const passLabel = useMemo(() => {
    if (!progress) return '';
    return PASS_LABELS[progress.currentPass] ?? '';
  }, [progress]);

  const passPercent = useMemo(() => {
    return clamp(progress?.passProgress ?? 0);
  }, [progress?.passProgress]);

  const overallPercent = useMemo(() => {
    if (!progress) return 0;
    if (typeof progress.overallProgress === 'number') {
      return clamp(Math.round(progress.overallProgress));
    }
    const total = Math.max(1, progress.totalPasses || 1);
    const passIndex = Math.max(1, progress.passNumber || 1);
    const passPart = clamp(progress.passProgress || 0) / 100;
    const computed = ((passIndex - 1) / total + passPart / total) * 100;
    return clamp(Math.round(computed));
  }, [progress]);

  const scenesText = useMemo(() => {
    const analyzed = progress?.scenesAnalyzed ?? 0;
    const total = progress?.totalScenes ?? 0;
    return `${analyzed} / ${total} scenes analyzed`;
  }, [progress]);

  return (
    <div
      className={[
        'fixed bottom-4 right-4 z-50',
        'transition-all duration-300 ease-out',
        show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
      ].join(' ')}
      aria-hidden={!show}
    >
      <div className="min-w-80 max-w-sm w-[min(90vw,28rem)] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {passLabel}
              {progress ? (
                <span className="ml-1 text-gray-600 dark:text-gray-300 font-normal">
                  ({Math.max(1, progress.passNumber)} / {Math.max(1, progress.totalPasses)})
                </span>
              ) : null}
            </div>

            <div className="mt-2">
              <div
                className="h-2 w-full bg-gray-200 dark:bg-gray-800 rounded overflow-hidden"
                role="progressbar"
                aria-valuenow={passPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Current pass progress"
              >
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500 transition-[width] duration-300 ease-out"
                  style={{ width: `${passPercent}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
                <span>{scenesText}</span>
                <span className="font-medium">Overall: {overallPercent}%</span>
              </div>
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={cancel}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(GlobalCoherenceProgress);