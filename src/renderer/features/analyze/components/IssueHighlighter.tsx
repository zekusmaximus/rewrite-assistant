import React, { useMemo } from 'react';
import type { HighlightSpan } from '../hooks/useIssueHighlighting';

export interface IssueHighlighterProps {
  content: string;
  spans: HighlightSpan[];
  className?: string;
}

const SEVERITY_ORDER: Record<'must-fix' | 'should-fix' | 'consider', number> = {
  'must-fix': 3,
  'should-fix': 2,
  'consider': 1,
} as const;

type Segment = {
  start: number;
  end: number;
  text: string;
  active: HighlightSpan[];
  top?: HighlightSpan;
  title?: string;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const bigint = parseInt(full, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const a = clamp(alpha, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * IssueHighlighter
 * Renders content with inline issue highlighting. Overlaps are resolved by choosing the
 * highest zIndex (severity) as the visible highlight for each segment, while the tooltip
 * aggregates all overlapping issues affecting that segment.
 */
function IssueHighlighter(props: IssueHighlighterProps) {
  const { content, spans, className } = props;

  const segments = useMemo<Segment[] | null>(() => {
    const len = content?.length ?? 0;
    if (!content || len === 0 || !spans || spans.length === 0) {
      return null;
    }

    // Normalize and constrain spans to [0, len]
    const normalized: HighlightSpan[] = spans
      .map((s) => {
        const start = clamp(Math.min(s.start, s.end), 0, len);
        const end = clamp(Math.max(s.start, s.end), 0, len);
        if (end <= start) return null;
        return { ...s, start, end };
      })
      .filter((s): s is HighlightSpan => !!s);

    if (normalized.length === 0) return null;

    // Collect all breakpoint indices
    const breaks = new Set<number>([0, len]);
    for (const s of normalized) {
      breaks.add(s.start);
      breaks.add(s.end);
    }
    const points = Array.from(breaks).sort((a, b) => a - b);

    const segs: Segment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const lo = points[i]!;
      const hi = points[i + 1]!;
      if (hi <= lo) continue;

      const text = content.slice(lo, hi);

      // Find overlapping spans for this interval
      const active = normalized.filter((s) => s.start < hi && s.end > lo);

      if (active.length === 0) {
        segs.push({ start: lo, end: hi, text, active: [] });
        continue;
      }

      // Determine top-visible span with deterministic tiebreakers
      const top = [...active].sort((a, b) => {
        if (a.zIndex !== b.zIndex) return b.zIndex - a.zIndex;
        const sa = SEVERITY_ORDER[a.severity];
        const sb = SEVERITY_ORDER[b.severity];
        if (sa !== sb) return sb - sa;
        if (a.start !== b.start) return b.start - a.start;
        if (a.end !== b.end) return b.end - a.end;
        return a.issueId.localeCompare(b.issueId);
      })[0];

      // Build combined tooltip; normalize "Fix:" separator
      const lines = active.map((s) => (s.tooltip ?? '').replace(/\. Fix:/g, ' • Fix:'));
      const title = `Issue(s):\n${lines.join('\n')}`;

      segs.push({ start: lo, end: hi, text, active, top, title });
    }

    return segs;
  }, [content, spans]);

  // Plain rendering when nothing to highlight, preserving whitespace/newlines
  if (!content || !segments) {
    return (
      <pre className={['whitespace-pre-wrap break-words', className].filter(Boolean).join(' ')}>
        {content}
      </pre>
    );
  }

  return (
    <pre className={['whitespace-pre-wrap break-words', className].filter(Boolean).join(' ')}>
      {segments.map((seg) => {
        const key = `${seg.start}-${seg.end}`;
        if (!seg.active.length || !seg.top) {
          return <span key={key}>{seg.text}</span>;
        }

        const bg = hexToRgba(seg.top.color, 0.18);
        const border = hexToRgba(seg.top.color, 0.35);

        return (
          <span
            key={key}
            title={seg.title}
            data-highlight="true"
            data-issue-count={seg.active.length}
            data-top-severity={seg.top.severity}
            data-types={seg.active.map((a) => a.type).join(',')}
            style={{
              backgroundColor: bg,
              borderBottom: `2px solid ${border}`,
            }}
            className="rounded-sm"
          >
            {seg.text}
          </span>
        );
      })}
    </pre>
  );
}

export default React.memo(IssueHighlighter);