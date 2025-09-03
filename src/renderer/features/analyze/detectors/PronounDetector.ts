import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import BaseDetector, { LocalDetectionResult } from './BaseDetector';

/**
 * Hybrid pronoun continuity detector:
 * - Local heuristics via compromise.js (with safe fallbacks)
 * - Selective AI validation for ambiguous cases
 */

// ---------- Internal types (exported for tests) ----------
export interface SentenceInfo {
  text: string;
  start: number;
  end: number;
}

export interface PronounInstance {
  pronoun: string;
  start: number;
  end: number;
  sentenceIndex: number;
}

export interface PronounDetectionTarget {
  pronoun: string;
  sentenceText: string;
  context: string;
  antecedents: string[];
  span: [number, number];
  sentenceIndex: number;
}

// Pronouns considered (exclude first-person to avoid false flags)
const PRONOUNS = [
  'he','she','him','her','his','hers',
  'they','them','their','theirs',
  'it','its',
  'this','that','these','those'
];
const THEY_GROUP = new Set(['they','them','their','theirs']);

// Cache of previous scene people by signature of scene ids
const prevPeopleCache: Map<string, string[]> = new Map();

// ---------- Small, pure helpers (exported for tests) ----------
export function splitSentences(text: string): SentenceInfo[] {
  const out: SentenceInfo[] = [];
  try {
    const re = /[^.!?]+(?:[.!?]+|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ text: text.slice(m.index, m.index + m[0].length).trim(), start: m.index, end: m.index + m[0].length });
    }
  } catch {
    // no-op
  }
  if (out.length === 0) out.push({ text, start: 0, end: text.length });
  return out;
}

export function findPronouns(text: string, sentences: SentenceInfo[]): PronounInstance[] {
  const list: PronounInstance[] = [];
  const re = new RegExp(`\\b(${PRONOUNS.join('|')})\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    let si = sentences.findIndex(s => start >= s.start && start < s.end);
    if (si < 0) si = 0;
    list.push({ pronoun: m[0].toLowerCase(), start, end, sentenceIndex: si });
  }
  return list;
}

export function tokenIndexAtOffset(text: string, offset: number): number {
  const re = /\b[\w']+\b/g;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= offset) return idx;
    idx++;
  }
  return idx;
}

export function contextSnippet(text: string, start: number, end: number, radius = 100): string {
  const s = Math.max(0, start - radius);
  const e = Math.min(text.length, end + radius);
  return text.slice(s, e).trim();
}

export function extractPeopleNames(text: string, nlpDoc?: any): string[] {
  const names = new Set<string>();
  try {
    if (nlpDoc && typeof nlpDoc.people === 'function') {
      const arr: string[] = nlpDoc.people().out('array') ?? [];
      for (const n of arr) if (n && typeof n === 'string') names.add(n.trim());
    } else {
      const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) names.add(m[1]);
    }
  } catch {
    // ignore
  }
  return Array.from(names);
}

export function extractNearbyProperNouns(text: string, sentences: SentenceInfo[], si: number): string[] {
  const startIdx = Math.max(0, si - 2);
  const endIdx = Math.min(sentences.length - 1, si + 2);
  const spanStart = sentences[startIdx].start;
  const spanEnd = sentences[endIdx].end;
  const seg = text.slice(spanStart, spanEnd);
  const set = new Set<string>();
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) set.add(m[1]);
  return Array.from(set);
}

export function previousScenesSignature(previous: readonly Scene[]): string {
  return previous.map(s => s.id).join('|');
}

export function getOrBuildPreviousPeople(previous: readonly Scene[], signature: string): string[] {
  const cached = prevPeopleCache.get(signature);
  if (cached) return cached;
  const set = new Set<string>();
  for (const sc of previous) {
    for (const n of extractPeopleNames(sc.text)) set.add(n);
  }
  const arr = Array.from(set);
  prevPeopleCache.set(signature, arr);
  return arr;
}

export function dedupeNormalize(names: readonly string[]): string[] {
  const norm = new Set<string>();
  for (const n of names) {
    const t = n.trim();
    if (!t) continue;
    norm.add(t);
  }
  return Array.from(norm);
}

export function buildReaderContext(known: readonly string[]): ReaderKnowledge {
  return {
    knownCharacters: new Set(known),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };
}

// Compromise-assisted hinting (words only; offsets found via regex)
export function collectPronounHints(nlpDoc: any): string[] {
  try {
    if (nlpDoc && typeof nlpDoc.match === 'function') {
      const arr: string[] = nlpDoc.match('#Pronoun').out('array') ?? [];
      return Array.isArray(arr) ? arr : [];
    }
  } catch {
    // ignore
  }
  return [];
}

// Aggregate local issues/targets
export function analyzeLocalPronouns(
  sceneText: string,
  sentences: SentenceInfo[],
  pronouns: PronounInstance[],
  currentPeople: string[],
  previousPeople: string[]
): { issues: ContinuityIssue[]; targets: PronounDetectionTarget[] } {
  const issues: ContinuityIssue[] = [];
  const targets: PronounDetectionTarget[] = [];
  for (const p of pronouns) {
    const res = assessPronounInstance(p, sceneText, sentences, currentPeople, previousPeople);
    if (res.issues.length) issues.push(...res.issues);
    if (res.target) targets.push(res.target);
  }
  return { issues, targets };
}

// Per-pronoun assessment
export function assessPronounInstance(
  p: PronounInstance,
  sceneText: string,
  sentences: SentenceInfo[],
  currentPeople: string[],
  previousPeople: string[]
): { issues: ContinuityIssue[]; target?: PronounDetectionTarget } {
  const issues: ContinuityIssue[] = [];
  const isOpening = p.sentenceIndex === 0;
  const tokenIdx = tokenIndexAtOffset(sceneText, p.start);
  const near = extractNearbyProperNouns(sceneText, sentences, p.sentenceIndex);
  const plausibleLocal = dedupeNormalize([...near, ...currentPeople]);
  const hasLocal = plausibleLocal.length > 0;
  const hasPrev = previousPeople.length > 0;

  if (isOpening && !hasLocal && !hasPrev) {
    issues.push({
      type: 'pronoun',
      severity: 'must-fix',
      description: `Opening sentence uses pronoun "${p.pronoun}" without a clear antecedent.`,
      textSpan: [p.start, p.end],
    });
    return { issues };
  }

  if (tokenIdx < 25 && !hasLocal) {
    issues.push({
      type: 'pronoun',
      severity: 'should-fix',
      description: `Early pronoun "${p.pronoun}" lacks a nearby antecedent.`,
      textSpan: [p.start, p.end],
    });
  }

  const ambiguousLocal = plausibleLocal.length >= 2;
  const groupAmbiguity = THEY_GROUP.has(p.pronoun) && (plausibleLocal.length + previousPeople.length) >= 2;
  if (ambiguousLocal || groupAmbiguity) {
    const si = Math.max(0, Math.min(p.sentenceIndex, sentences.length - 1));
    return {
      issues,
      target: {
        pronoun: p.pronoun,
        sentenceText: sentences[si]?.text ?? '',
        context: contextSnippet(sceneText, p.start, p.end),
        antecedents: dedupeNormalize([...plausibleLocal, ...previousPeople]),
        span: [p.start, p.end],
        sentenceIndex: si,
      },
    };
  }
  return { issues };
}

// Known-people assembly
export function assembleKnownPeople(previousScenes: readonly Scene[], sceneText: string): string[] {
  const sig = previousScenesSignature(previousScenes);
  const previousPeople = getOrBuildPreviousPeople(previousScenes, sig);
  const currentPeople = extractPeopleNames(sceneText);
  return dedupeNormalize([...previousPeople, ...currentPeople]);
}

// Compose compact AI scene text including detection targets (bounded)
export function buildAIText(original: string, targets: readonly PronounDetectionTarget[], maxTargets = 6): string {
  const chosen = targets.slice(0, maxTargets);
  const headerLines = [
    '[[Pronoun detection targets]]',
    ...chosen.map(c => {
      const ant = c.antecedents.slice(0, 6).join(', ') || 'none';
      const sent = (c.sentenceText || '').slice(0, 160);
      return `- "${c.pronoun}" @ [${c.span[0]},${c.span[1]}] | sentence: "${sent}" | antecedents: ${ant}`;
    }),
    '[[Scene]]',
  ];
  const header = headerLines.join('\n');
  return `${header}\n\n${original}`;
}

// Build AI request with detection target summary embedded into scene.text
export function buildAIRequest(
  scene: Scene,
  prevForAI: readonly Scene[],
  targets: readonly PronounDetectionTarget[],
  known: readonly string[]
) {
  const sceneForAI: Scene = { ...scene, text: buildAIText(scene.text, targets) };
  return {
    scene: sceneForAI,
    previousScenes: prevForAI as Scene[],
    analysisType: 'simple' as const,
    readerContext: buildReaderContext(known),
  };
}

// Map AI response back to ContinuityIssue[], filtered to known targets when spans are present
export function mapAIResponseToIssues(
  resp: { issues?: ContinuityIssue[] } | null | undefined,
  sceneText: string,
  targets: readonly PronounDetectionTarget[]
): ContinuityIssue[] {
  const targetKeys = new Set(targets.map(c => `${c.span[0]}|${c.span[1]}`));
  const out: ContinuityIssue[] = [];
  for (const it of resp?.issues ?? []) {
    const type = it.type ?? 'pronoun';
    if (type !== 'pronoun') continue;
    const [s, e] = it.textSpan ?? [NaN, NaN];
    if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) {
      out.push({
        type: 'pronoun',
        severity: it.severity ?? 'should-fix',
        description: it.description ?? 'Pronoun ambiguity detected',
        textSpan: it.textSpan ?? [0, Math.min(1, sceneText.length)],
        suggestedFix: it.suggestedFix,
      });
    } else if (targetKeys.has(`${s}|${e}`)) {
      out.push({
        type: 'pronoun',
        severity: it.severity ?? 'should-fix',
        description: it.description ?? 'Pronoun ambiguity detected',
        textSpan: [s, e],
        suggestedFix: it.suggestedFix,
      });
    }
  }
  return out;
}

// ---------- Detector implementation ----------
export default class PronounDetector extends BaseDetector<PronounDetectionTarget> {
  public readonly detectorType = 'pronoun' as const;

  protected async localDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    _aiManager: AIServiceManager
  ): Promise<LocalDetectionResult<PronounDetectionTarget>> {
    if (!scene?.text || typeof scene.text !== 'string' || scene.text.trim().length === 0) {
      return { issues: [], requiresAI: false, targets: [] };
    }

    const doc = await this.safeNLP(scene.text);
    const sentences = splitSentences(scene.text);
    const pronouns = findPronouns(scene.text, sentences);
    const currentPeople = extractPeopleNames(scene.text, doc);
    const sig = previousScenesSignature(previousScenes);
    const previousPeople = getOrBuildPreviousPeople(previousScenes, sig);

    const hints = doc ? collectPronounHints(doc) : [];
    console.debug('[PronounDetector] pronouns found:', pronouns.length, 'compromise hints:', hints.length);

    const { issues, targets } = analyzeLocalPronouns(
      scene.text,
      sentences,
      pronouns,
      currentPeople,
      previousPeople
    );

    console.debug('[PronounDetector] local issues:', issues.length, 'targets:', targets.length);
    return {
      issues,
      requiresAI: targets.length > 0,
      targets,
      stats: { pronouns: pronouns.length },
    };
  }

  protected async aiDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    targets: readonly PronounDetectionTarget[]
  ): Promise<ContinuityIssue[]> {
    if (!targets || targets.length === 0) return [];

    const known = assembleKnownPeople(previousScenes, scene.text);
    const prevForAI = previousScenes.slice(-2).map(s => ({ ...s, text: s.text?.slice(0, 600) ?? '' }));

    console.debug('[PronounDetector] invoking AI for targets:', targets.length);
    const req = buildAIRequest(scene, prevForAI, targets, known);
    const resp = await this.aiAnalyzeSimple(aiManager, req);

    const out = mapAIResponseToIssues(resp, scene.text, targets);
    console.debug('[PronounDetector] AI returned pronoun issues:', out.length);
    return out;
  }

  // Mock-friendly indirection for AI calls
  protected async aiAnalyzeSimple(
    aiManager: AIServiceManager,
    req: Parameters<AIServiceManager['analyzeContinuity']>[0]
  ) {
    try {
      return await aiManager.analyzeContinuity(req);
    } catch (err) {
      console.debug('[PronounDetector] AI analyzeContinuity failed; degrading to local-only.', err);
      return { issues: [], metadata: { modelUsed: 'none', provider: 'openai', costEstimate: 0, durationMs: 0, confidence: 0, cached: false } };
    }
  }
}