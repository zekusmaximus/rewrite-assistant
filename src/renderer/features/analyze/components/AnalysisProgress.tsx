import React, { useMemo } from 'react';

type AnalysisStage = 'detecting' | 'ai-validation' | 'finalizing';

export interface AnalysisProgressProps {
  isAnalyzing: boolean;
  progress: { current: number; total: number; stage: AnalysisStage };
  currentScene?: string;
  className?: string;
}

const STAGE_LABELS: Record<AnalysisStage, string> = {
  'detecting': 'Detecting issues',
  'ai-validation': 'AI validation',
  'finalizing': 'Finalizing',
} as const;

function AnalysisProgress(props: AnalysisProgressProps) {
  const { isAnalyzing, progress, className } = props;
  const total = Math.max(0, progress?.total ?? 0);
  const current = Math.min(Math.max(0, progress?.current ?? 0), total);
  const stage: AnalysisStage = progress?.stage ?? 'detecting';

  const percent = useMemo(() => {
    if (!isAnalyzing || total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  }, [isAnalyzing, current, total]);

  // Not analyzing: show completion info if any scenes processed, else render nothing
  if (!isAnalyzing) {
    if (total > 0) {
      return (
        <div className={['w-full text-xs text-gray-700 dark:text-gray-200', className].filter(Boolean).join(' ')}>
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden" aria-hidden="true">
              <div
                className="h-full bg-emerald-500 dark:bg-emerald-400"
                style={{ width: '100%' }}
              />
            </div>
            <span className="whitespace-nowrap">Analysis complete • {total} scene{total === 1 ? '' : 's'} processed</span>
          </div>
        </div>
      );
    }
    return null;
  }

  const stageLabel = STAGE_LABELS[stage];

  return (
    <div className={['w-full text-xs text-gray-700 dark:text-gray-200', className].filter(Boolean).join(' ')}>
      <div className="flex items-center gap-2">
        <div
          className="h-1 flex-1 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden"
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, total)}
          aria-label="Analyzing moved scenes"
        >
          <div
            className="h-full bg-indigo-500 dark:bg-indigo-400 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="whitespace-nowrap">
          Analyzing… {current}/{total} • {stageLabel}
        </span>
      </div>
    </div>
  );
}

export default React.memo(AnalysisProgress);