import type { ContinuityIssue } from '../../../../shared/types';

type Sev = ContinuityIssue['severity'];
type Typ = ContinuityIssue['type'];
type WithMeta = ContinuityIssue & { _src?: string };

const TYPE_ORDER: readonly Typ[] = ['pronoun', 'character', 'plot', 'timeline', 'engagement', 'context'];

/** Rank severities: must-fix(3) > should-fix(2) > consider(1) */
export function severityRank(sev: Sev): number {
  switch (sev) {
    case 'must-fix': return 3;
    case 'should-fix': return 2;
    case 'consider': return 1;
    default: return 2;
  }
}

function sanitizeDescription(desc: unknown): string {
  const s = String(desc ?? '').replace(/\s+/g, ' ').trim();
  return s;
}

function sanitizeSpan(span: unknown): [number, number] {
  if (!Array.isArray(span) || span.length < 2) return [0, 0];
  let s = Number(span[0]); let e = Number(span[1]);
  if (!Number.isFinite(s)) s = 0;
  if (!Number.isFinite(e)) e = 0;
  if (s > e) [s, e] = [e, s];
  if (s < 0) s = 0;
  if (e < 0) e = 0;
  return [s, e];
}

function sanitizeSeverity(sev: unknown): Sev {
  return sev === 'must-fix' || sev === 'should-fix' || sev === 'consider' ? sev : 'should-fix';
}

function sanitizeIssue<T extends ContinuityIssue>(issue: T): T {
  const fixed = {
    ...issue,
    description: sanitizeDescription((issue as any).description),
    textSpan: sanitizeSpan((issue as any).textSpan),
    severity: sanitizeSeverity((issue as any).severity),
  };
  return fixed as T;
}

/** Normalize issues defensively; does not mutate inputs. */
export function normalizeIssues(issues: readonly ContinuityIssue[]): ContinuityIssue[] {
  return issues.map((i) => sanitizeIssue(i));
}

function normForSim(s: string): string {
  return s.toLowerCase().replace(/[0-9]+/g, '').replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function prefixSimilar(a: string, b: string): boolean {
  const A = normForSim(a); const B = normForSim(b);
  if (!A || !B) return false;
  const short = A.length <= B.length ? A : B;
  const long = A.length <= B.length ? B : A;
  return long.startsWith(short);
}

/** Build duplicate groups via connectivity using the rules in requirements. */
export function findDuplicateGroups(issues: readonly ContinuityIssue[]): number[][] {
  const n = issues.length, groups: number[][] = [], visited = new Array(n).fill(false);
  const getSpan = (i: number) => issues[i].textSpan ?? [0, 0];
  const len = (s: [number, number]) => Math.max(0, s[1] - s[0]);
  const ovl = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  const isDup = (i: number, j: number): boolean => {
    const A = issues[i], B = issues[j], sa = getSpan(i), sb = getSpan(j);
    if (A.description === B.description && sa[0] === sb[0]) return true;
    const o = ovl(sa, sb), short = Math.min(len(sa), len(sb)), ps = prefixSimilar(A.description, B.description);
    if (A.type === B.type) return same(sa, sb) || (short > 0 && o / short >= 0.5) || (ps && Math.abs(sa[0] - sb[0]) <= 30);
    return ps && Math.abs(sa[0] - sb[0]) <= 10;
  };
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const comp: number[] = [], q: number[] = [i]; visited[i] = true;
    while (q.length) {
      const u = q.shift() as number; comp.push(u);
      for (let v = 0; v < n; v++) if (!visited[v] && isDup(u, v)) { visited[v] = true; q.push(v); }
    }
    groups.push(comp);
  }
  return groups;
}

function truncate(s: string, max = 220): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

function dominantType(issues: readonly ContinuityIssue[]): Typ {
  const count = new Map<Typ, number>();
  const must = new Map<Typ, number>();
  for (const it of issues) {
    count.set(it.type, (count.get(it.type) ?? 0) + 1);
    must.set(it.type, (must.get(it.type) ?? 0) + (it.severity === 'must-fix' ? 1 : 0));
  }
  let best: Typ = issues[0]?.type ?? 'pronoun';
  for (const t of new Set(issues.map((i) => i.type))) {
    const c = count.get(t) ?? 0;
    const cm = must.get(t) ?? 0;
    const bc = count.get(best) ?? 0;
    const bm = must.get(best) ?? 0;
    if (c > bc || (c === bc && cm > bm) || (c === bc && cm === bm && (TYPE_ORDER.indexOf(t) - TYPE_ORDER.indexOf(best) < 0))) {
      best = t;
    }
  }
  return best;
}

/** Merge a group of duplicate issues into a representative issue. */
export function mergeGroup(issues: readonly ContinuityIssue[], groupIndexes: number[]): ContinuityIssue {
  const group = groupIndexes.map((i) => issues[i]);
  // Severity: highest
  let sev: Sev = 'consider';
  for (const it of group) if (severityRank(it.severity) > severityRank(sev)) sev = it.severity;
  // Span: minimal covering
  let start = Infinity, end = -Infinity;
  for (const it of group) { const [s, e] = it.textSpan ?? [0, 0]; if (s < start) start = s; if (e > end) end = e; }
  if (!Number.isFinite(start) || !Number.isFinite(end)) { start = 0; end = 0; }
  // Description: longest concise, then optional detector suffix
  let bestDesc = '';
  for (const it of group) if (sanitizeDescription(it.description).length > bestDesc.length) bestDesc = sanitizeDescription(it.description);
  bestDesc = truncate(bestDesc, 220);
  const srcs = new Set<string>();
  for (const it of group) { const s = (it as any)._src; if (typeof s === 'string' && s) srcs.add(s); }
  if (srcs.size > 1) {
    const suffix = Array.from(srcs).slice(0, 2).join(',');
    bestDesc = `${bestDesc} [from: ${suffix}]`;
  }
  // Suggested fix: prefer shortest non-empty
  let fix: string | undefined;
  const fixes = group.map((g) => sanitizeDescription(g.suggestedFix)).filter((f) => f.length > 0);
  if (fixes.length) fix = fixes.reduce((a, b) => (a.length <= b.length ? a : b));
  // Type: dominant by frequency, then must-fix count, then stable order
  const typ = dominantType(group);

  return {
    type: typ,
    severity: sev,
    description: bestDesc,
    textSpan: [Math.max(0, start), Math.max(0, end)],
    ...(fix ? { suggestedFix: fix } : {}),
  };
}

/** Sort by severity desc, start asc, shorter span first, then type alpha. */
export function sortIssues(issues: readonly ContinuityIssue[]): ContinuityIssue[] {
  return [...issues].sort((a, b) => {
    const sr = severityRank(b.severity) - severityRank(a.severity);
    if (sr !== 0) return sr;
    const [as, ae] = a.textSpan ?? [0, 0]; const [bs, be] = b.textSpan ?? [0, 0];
    if (as !== bs) return as - bs;
    const al = Math.max(0, ae - as), bl = Math.max(0, be - bs);
    if (al !== bl) return al - bl;
    return a.type.localeCompare(b.type);
  });
}

/**
 * Aggregates, de-duplicates, merges, prioritizes, and limits issues per UX rules.
 * - Flatten and tag by source
 * - Normalize and validate
 * - Group likely duplicates
 * - Merge groups
 * - Prioritize + sort
 * - Limit with must-fix overflow handling
 */
export default class IssueAggregator {
  public aggregate(detectorResults: Map<string, ContinuityIssue[]>): ContinuityIssue[] {
    // 1) Flatten with source tag
    const flat: WithMeta[] = [];
    for (const [src, arr] of detectorResults.entries()) {
      if (!Array.isArray(arr)) continue;
      for (const issue of arr) {
        const normalized = sanitizeIssue(issue as ContinuityIssue) as WithMeta;
        normalized._src = src;
        flat.push(normalized);
      }
    }

    // 2) (Already normalized above); build working copy for grouping
    const working: ContinuityIssue[] = flat as ContinuityIssue[];

    // 3) Duplicate grouping
    const groups = findDuplicateGroups(working);

    // 4) Merge per group
    const merged: ContinuityIssue[] = groups.map((g) => mergeGroup(working, g));

    // 5) Prioritize + sort
    const sorted = sortIssues(merged);

    // 6) Limit: top 10 normally; if must-fix > 10, include all must-fix then fill with should-fix up to 15
    const must = sorted.filter((i) => i.severity === 'must-fix');
    if (must.length > 10) {
      const should = sorted.filter((i) => i.severity === 'should-fix').slice(0, Math.max(0, 15 - must.length));
      return [...must, ...should];
    }
    return sorted.slice(0, 10);
  }
}