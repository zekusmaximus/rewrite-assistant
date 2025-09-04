import { useMemo, useCallback } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useAnalysisStore, { type IssueFilter } from '../stores/analysisStore';
import type { ContinuityIssue } from '../../../../shared/types';

// Local exported type to aid testing
export type HighlightSpan = {
  start: number;
  end: number;
  type: 'pronoun' | 'timeline' | 'character' | 'plot' | 'engagement';
  severity: 'must-fix' | 'should-fix' | 'consider';
  issueId: string;
  tooltip: string;
  color: string;
  zIndex: number;
};

/**
 * useIssueHighlighting()
 * Transforms analysis issues into text highlight spans consumable by the IssueHighlighter component.
 * No DOM operations; pure data transformation for rendering.
 */
export default function useIssueHighlighting() {
  // These are read to ensure reactively consistent memoization if manuscript context is later required.
  // Currently not used in calculations, but retained per spec imports.
  useManuscriptStore((s) => s.manuscript);

  const analyses = useAnalysisStore((s) => s.analyses);
  const selectedIssueTypes = useAnalysisStore((s) => s.selectedIssueTypes);

  const supportedTypes: ReadonlySet<IssueFilter> = useMemo(
    () => new Set<IssueFilter>(['pronoun', 'timeline', 'character', 'plot', 'engagement']),
    []
  );

  const severityRank = useMemo(
    () =>
      new Map<HighlightSpan['severity'], number>([
        ['consider', 100],
        ['should-fix', 200],
        ['must-fix', 300],
      ]),
    []
  );

  // Color palette by type and severity. Semantic mapping:
  // - must-fix: opaque red variants per type
  // - should-fix: amber variants per type
  // - consider: blue variants per type
  const palette = useMemo(
    () => ({
      pronoun: {
        'must-fix': '#dc2626', // red-600
        'should-fix': '#f59e0b', // amber-500
        consider: '#3b82f6', // blue-500
      },
      timeline: {
        'must-fix': '#b91c1c', // red-700
        'should-fix': '#d97706', // amber-600
        consider: '#60a5fa', // blue-400
      },
      character: {
        'must-fix': '#ef4444', // red-500
        'should-fix': '#f59e0b', // amber-500
        consider: '#93c5fd', // blue-300
      },
      plot: {
        'must-fix': '#be123c', // rose-700
        'should-fix': '#f59e0b', // amber-500
        consider: '#2563eb', // blue-600
      },
      engagement: {
        'must-fix': '#e11d48', // rose-600
        'should-fix': '#f59e0b', // amber-500
        consider: '#1d4ed8', // blue-700
      },
    }),
    []
  );

  const getColorForIssue = useCallback(
    (issue: ContinuityIssue): string => {
      const typeKey =
        (supportedTypes.has(issue.type as IssueFilter) ? (issue.type as HighlightSpan['type']) : 'plot');
      const severity: HighlightSpan['severity'] =
        issue.severity ?? 'should-fix';
      return palette[typeKey][severity];
    },
    [palette, supportedTypes]
  );

  const buildHighlightsForScene = useCallback(
    (sceneId: string): HighlightSpan[] => {
      const analysis = analyses.get(sceneId);
      if (!analysis || !analysis.issues || analysis.issues.length === 0) return [];

      const spans: HighlightSpan[] = [];
      for (const issue of analysis.issues) {
        // Only include selected types; exclude unsupported types like 'context'
        if (!selectedIssueTypes.has(issue.type as IssueFilter)) continue;

        // Adapt text span: shared type uses tuple [start, end]
        const tuple = issue.textSpan;
        if (!tuple || tuple.length !== 2) continue;
        const [a, b] = tuple;
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const start = Math.max(0, Math.min(a, b));
        const end = Math.max(0, Math.max(a, b));
        if (end <= start) continue;

        // Default severity if missing (defensive)
        const severity: HighlightSpan['severity'] = issue.severity ?? 'should-fix';

        // Tooltip text using available fields; omit Fix: if not present
        const fix = issue.suggestedFix;
        const header = `${issue.type}: ${issue.description}`;
        const tooltip = fix ? `${header}. Fix: ${fix}` : header;

        // Compute color and zIndex from palette and severity rank
        const typeKey =
          (supportedTypes.has(issue.type as IssueFilter) ? (issue.type as HighlightSpan['type']) : 'plot');
        const color = palette[typeKey][severity];
        const zIndex = severityRank.get(severity) ?? 200;

        // Build a stable id (if no id field exists on issue)
        const issueId =
          // @ts-expect-error optional foreign id field may exist in future
          (issue.id as string | undefined) ??
          `issue-${sceneId}-${issue.type}-${start}-${end}`;

        spans.push({
          start,
          end,
          type: typeKey,
          severity,
          issueId,
          tooltip,
          color,
          zIndex,
        });
      }

      return spans;
    },
    [analyses, selectedIssueTypes, palette, severityRank, supportedTypes]
  );

  const mergeOverlaps = useCallback(
    (spans: HighlightSpan[]): HighlightSpan[] => {
      // Do not mutate input; ensure zIndex honors severity for any overlaps.
      // Since buildHighlightsForScene already sets zIndex by severity, we can
      // recompute deterministically to enforce invariants.
      const toRank = (s: HighlightSpan['severity']) => severityRank.get(s) ?? 200;

      // Create new array with normalized zIndex based on severity
      const normalized = spans.map((s) => ({
        ...s,
        zIndex: toRank(s.severity),
      }));

      // When multiple spans overlap and share the same severity, maintain their zIndex equal.
      // Consumers can layer by DOM order or additional rules if needed.
      return normalized;
    },
    [severityRank]
  );

  const getScrollTarget = useCallback(
    (sceneId: string, issue: ContinuityIssue): string => {
      // Prefer a stable provided id if present; otherwise derive
      // @ts-expect-error optional foreign id field may exist in future
      const nativeId: string | undefined = issue.id;
      if (nativeId) return `issue-${sceneId}-${nativeId}`;

      const [a, b] = issue.textSpan ?? [0, 0];
      const start = Math.min(a ?? 0, b ?? 0);
      const end = Math.max(a ?? 0, b ?? 0);
      return `issue-${sceneId}-${issue.type}-${start}-${end}`;
    },
    []
  );

  return {
    buildHighlightsForScene,
    mergeOverlaps,
    getScrollTarget,
    getColorForIssue,
  };
}