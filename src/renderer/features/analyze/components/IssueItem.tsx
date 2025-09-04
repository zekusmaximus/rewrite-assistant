import React from 'react';
import type { ContinuityIssue } from '../../../../shared/types';

export interface IssueItemProps {
  issue: ContinuityIssue;
  sceneId: string;
  sceneTitle?: string;
  scenePosition?: number;
  onShowInScene?: (issue: ContinuityIssue, sceneId: string) => void;
  onDismiss?: (issue: ContinuityIssue, sceneId: string) => void;
  className?: string;
}

const SEVERITY_ORDER: Record<'must-fix' | 'should-fix' | 'consider', number> = {
  'must-fix': 3,
  'should-fix': 2,
  'consider': 1,
} as const;

const SEVERITY_LABEL: Record<'must-fix' | 'should-fix' | 'consider', string> = {
  'must-fix': 'MUST FIX',
  'should-fix': 'SHOULD FIX',
  'consider': 'CONSIDER',
} as const;

const SEVERITY_CLASS: Record<'must-fix' | 'should-fix' | 'consider', string> = {
  'must-fix': 'bg-red-500/20 text-red-700 dark:text-red-200 border border-red-500/30',
  'should-fix': 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30',
  'consider': 'bg-blue-500/20 text-blue-700 dark:text-blue-200 border border-blue-500/30',
} as const;

type IssueKind = 'pronoun' | 'timeline' | 'character' | 'plot' | 'engagement' | 'context';

const TYPE_ICON: Record<IssueKind, string> = {
  pronoun: '📝',
  timeline: '⏱️',
  character: '🧑',
  plot: '🧩',
  engagement: '✨',
  context: '🧩', // treat unknown/context like plot for display
} as const;

const TYPE_LABEL: Record<IssueKind, string> = {
  pronoun: 'pronoun',
  timeline: 'timeline',
  character: 'character',
  plot: 'plot',
  engagement: 'engagement',
  context: 'context',
} as const;

function IssueItem(props: IssueItemProps) {
  const { issue, sceneId, sceneTitle, scenePosition, onShowInScene, onDismiss, className } = props;

  const severity: 'must-fix' | 'should-fix' | 'consider' =
    (issue.severity as 'must-fix' | 'should-fix' | 'consider') ?? 'should-fix';

  const typeKey: IssueKind =
    (['pronoun', 'timeline', 'character', 'plot', 'engagement', 'context'] as IssueKind[]).includes(
      issue.type as IssueKind
    )
      ? (issue.type as IssueKind)
      : 'plot';

  const icon = TYPE_ICON[typeKey];
  const typeLabel = TYPE_LABEL[typeKey];

  const handleShow = () => {
    if (onShowInScene) onShowInScene(issue, sceneId);
  };

  const handleDismiss = () => {
    if (onDismiss) onDismiss(issue, sceneId);
  };

  // Build context line exactly as specified, while avoiding awkward double spaces
  const positionText = scenePosition != null ? String(scenePosition) : '';
  const titleText = sceneTitle ?? sceneId;
  const contextLine = `Scene ${positionText}: ${titleText} (moved)`;

  return (
    <div
      className={[
        'w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/40 p-3 shadow-sm',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-severity={severity}
      data-type={typeLabel}
      aria-label={`Issue ${typeLabel} ${SEVERITY_LABEL[severity]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">{icon}</span>
          <span className={['text-[10px] leading-4 px-2 py-0.5 rounded-full uppercase tracking-wide font-semibold', SEVERITY_CLASS[severity]].join(' ')}>
            {SEVERITY_LABEL[severity]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onShowInScene ? (
            <button
              type="button"
              onClick={handleShow}
              className="text-xs px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 transition"
            >
              Show in Scene
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={handleDismiss}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">
        <div className="font-medium">{typeLabel}</div>
        <div className="mt-1">{issue.description}</div>
        {issue.suggestedFix ? (
          <div className="mt-1 text-gray-700 dark:text-gray-300">
            <span className="font-medium">Fix:</span> {issue.suggestedFix}
          </div>
        ) : null}
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">{contextLine}</div>
      </div>
    </div>
  );
}

export default React.memo(IssueItem);