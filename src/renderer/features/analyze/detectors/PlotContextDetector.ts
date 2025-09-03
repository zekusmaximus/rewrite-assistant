import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import BaseDetector, { LocalDetectionResult } from './BaseDetector';

/**
 * Hybrid Plot/Context continuity detector (Detector 4 - Phase 2):
 * - Local NLP with compromise.js (safe load) + regex fallbacks
 * - Detects forward references, world-building assumptions, and causal gaps
 * - Selective AI validation for complex/ambiguous cases (analysisType: "complex")
 *
 * Helper functions are kept small (≤ 40 lines) and exported where tests need them.
 */

// ---------- Types (exported for tests where needed) ----------
export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

interface Stat {
  count: number;
  firstSpan?: [number, number];
}

export interface PreviousPlotRegistry {
  signature: string;
  events: Record<string, Stat>;
  entities: Record<string, Stat>;
  causal: Array<{ connector: string; sentence: string }>;
}

export type PlotCueKind = 'definiteEvent' | 'forwardRef' | 'worldEntity' | 'causalConnector';

export interface PlotObservation {
  kind: PlotCueKind;
  markerText: string;
  start: number;
  end: number;
  sentenceIndex: number;
  sentenceText?: string;
  head?: string;
  connector?: string;
}

export interface PlotCandidate {
  markerText: string;
  sentenceText: string;
  context: string;
  span: [number, number];
  sentenceIndex: number;
  registrySummary: string[];
  otherCues: string[];
}

// ---------- Constants ----------
const EVENT_HEADS = [
  'incident','plan','attack','meeting','report','operation','secret','truth','betrayal','leak',
  'accident','ambush','deal','ceremony','trial','storm','outbreak','lockdown','discovery',
  'letter','note','photo','message'
];

const FORWARD_ALLOW = [
  'promise','plan','deal','thing','attack','note','letter','message','report','secret','truth',
  'leak','accident','ambush','trial','storm','outbreak','lockdown','discovery','incident','meeting','operation','photo'
];

const CONNECTORS = ['because', 'therefore', 'so that', 'as a result', 'since', 'due to'];

// ---------- Caches ----------
const prevRegistryCache: Map<string, PreviousPlotRegistry> = new Map();

// ---------- Small utilities ----------
function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

function contextSnippet(text: string, start: number, end: number, radius = 120): string {
  const s = Math.max(0, start - radius);
  const e = Math.min(text.length, end + radius);
  return text.slice(s, e).trim();
}

function previousScenesSignature(previous: readonly Scene[]): string {
  return previous.map(s => s.id).join('|');
}

function registryIsEmpty(reg: PreviousPlotRegistry): boolean {
  return Object.keys(reg.events).length === 0 && Object.keys(reg.entities).length === 0 && reg.causal.length === 0;
}

// ---------- Exported helpers (testing hooks) ----------
export function splitSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  try {
    const re = /[^.!?]+(?:[.!?]+|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      out.push({ text: text.slice(start, end).trim(), start, end });
    }
  } catch {
    // ignore
  }
  if (out.length === 0) out.push({ text, start: 0, end: text.length });
  return out;
}

export function detectCausalConnectors(sentenceText: string): string[] {
  const found: string[] = [];
  const lower = sentenceText.toLowerCase();
  for (const c of CONNECTORS) {
    if (lower.includes(c)) found.push(c);
  }
  return found;
}

function findAllInSentence(text: string, sent: SentenceSpan, re: RegExp): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const segment = text.slice(sent.start, sent.end);
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const s = sent.start + m.index;
    const e = s + m[0].length;
    out.push({ start: s, end: e, text: m[0] });
  }
  return out;
}

export function extractEventMentions(text: string, sentences: SentenceSpan[]): PlotObservation[] {
  const obs: PlotObservation[] = [];
  const heads = EVENT_HEADS.join('|');
  const defRe = new RegExp(`\\bthe\\s+(${heads})\\b`, 'gi');
  const thatRe = new RegExp(`\\bthat\\s+(${FORWARD_ALLOW.join('|')})\\b`, 'gi');
  const whatRe = /\bwhat\s+(?:we\s+|they\s+|he\s+|she\s+|happened\b|was\b)/gi;

  sentences.forEach((sent, si) => {
    for (const m of findAllInSentence(text, sent, defRe)) {
      const head = m.text.replace(/^the\s+/i, '').toLowerCase();
      obs.push({ kind: 'definiteEvent', markerText: m.text, start: m.start, end: m.end, sentenceIndex: si, sentenceText: sent.text, head });
    }
    for (const m of findAllInSentence(text, sent, thatRe)) {
      const head = m.text.replace(/^that\s+/i, '').toLowerCase();
      obs.push({ kind: 'forwardRef', markerText: m.text, start: m.start, end: m.end, sentenceIndex: si, sentenceText: sent.text, head });
    }
    for (const m of findAllInSentence(text, sent, whatRe)) {
      obs.push({ kind: 'forwardRef', markerText: m.text, start: m.start, end: m.end, sentenceIndex: si, sentenceText: sent.text });
    }
  });
  return obs;
}

// ----- World entities helpers (keep tiny) -----
function pushAllCapsEntities(seg: string, baseStart: number, known: Set<string>, sentText: string, si: number, out: PlotObservation[]): void {
  const allCapsRe = /\b([A-Z]{2,})\b/g;
  let m: RegExpExecArray | null;
  allCapsRe.lastIndex = 0;
  while ((m = allCapsRe.exec(seg)) !== null) {
    const s = baseStart + m.index;
    const e = s + m[0].length;
    const key = normalizeKey(m[1]);
    if (!known.has(key)) {
      out.push({ kind: 'worldEntity', markerText: m[1], start: s, end: e, sentenceIndex: si, sentenceText: sentText });
    }
  }
}

function pushProperNounEntities(seg: string, baseStart: number, known: Set<string>, people: Set<string>, sentText: string, si: number, out: PlotObservation[]): void {
  const personRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let m: RegExpExecArray | null;
  personRe.lastIndex = 0;
  while ((m = personRe.exec(seg)) !== null) {
    const s = baseStart + m.index;
    const isStart = m.index <= 1;
    const phrase = m[1];
    const key = normalizeKey(phrase);
    if (isStart) continue;
    if (people.has(phrase)) continue;
    if (!known.has(key)) {
      const e = s + phrase.length;
      out.push({ kind: 'worldEntity', markerText: phrase, start: s, end: e, sentenceIndex: si, sentenceText: sentText });
    }
  }
}

function collectPeople(nlpDoc: any | null): Set<string> {
  const people = new Set<string>();
  try {
    if (nlpDoc && typeof nlpDoc.people === 'function') {
      for (const p of nlpDoc.people().out('array') ?? []) {
        if (typeof p === 'string') people.add(p);
      }
    }
  } catch {
    // ignore
  }
  return people;
}

function extractWorldEntitiesCurrent(text: string, sentences: SentenceSpan[], registry: PreviousPlotRegistry, nlpDoc: any | null): PlotObservation[] {
  const obs: PlotObservation[] = [];
  const known = new Set(Object.keys(registry.entities).map(normalizeKey));
  const people = collectPeople(nlpDoc);

  sentences.forEach((sent, si) => {
    const seg = text.slice(sent.start, sent.end);
    pushAllCapsEntities(seg, sent.start, known, sent.text, si, obs);
    pushProperNounEntities(seg, sent.start, known, people, sent.text, si, obs);
  });
  return obs;
}

function extractCausalConnectors(text: string, sentences: SentenceSpan[]): PlotObservation[] {
  const out: PlotObservation[] = [];
  sentences.forEach((sent, si) => {
    for (const conn of detectCausalConnectors(sent.text)) {
      const idx = sent.text.toLowerCase().indexOf(conn);
      if (idx >= 0) {
        const s = sent.start + idx;
        const e = s + conn.length;
        out.push({ kind: 'causalConnector', markerText: conn, start: s, end: e, sentenceIndex: si, sentenceText: sent.text, connector: conn });
      }
    }
  });
  return out;
}

// ----- Previous registry scanners (kept small) -----
function scanEventsInto(text: string, events: Record<string, Stat>): void {
  const heads = EVENT_HEADS.join('|');
  const eventRe = new RegExp(`\\bthe\\s+(${heads})\\b`, 'gi');
  let m: RegExpExecArray | null;
  eventRe.lastIndex = 0;
  while ((m = eventRe.exec(text)) !== null) {
    const head = normalizeKey(m[1]);
    const s = m.index;
    const e = s + m[0].length;
    const stat = (events[head] ??= { count: 0 });
    stat.count++;
    if (!stat.firstSpan) stat.firstSpan = [s, e];
  }
}

function scanAllCapsInto(text: string, entities: Record<string, Stat>): void {
  const allCapsRe = /\b([A-Z]{2,})\b/g;
  let m: RegExpExecArray | null;
  allCapsRe.lastIndex = 0;
  while ((m = allCapsRe.exec(text)) !== null) {
    const key = normalizeKey(m[1]);
    const s = m.index;
    const e = s + m[0].length;
    const stat = (entities[key] ??= { count: 0 });
    stat.count++;
    if (!stat.firstSpan) stat.firstSpan = [s, e];
  }
}

function scanSentenceLevelInto(text: string, entities: Record<string, Stat>, causal: Array<{ connector: string; sentence: string }>): void {
  const properRe = /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/g;
  const sents = splitSentences(text);
  for (const sent of sents) {
    const seg = text.slice(sent.start, sent.end);
    let n: RegExpExecArray | null;
    properRe.lastIndex = 0;
    while ((n = properRe.exec(seg)) !== null) {
      if (n.index <= 1) continue;
      const phrase = n[1];
      const key = normalizeKey(phrase);
      const s = sent.start + n.index;
      const e = s + phrase.length;
      const stat = (entities[key] ??= { count: 0 });
      stat.count++;
      if (!stat.firstSpan) stat.firstSpan = [s, e];
    }
    for (const c of detectCausalConnectors(sent.text)) {
      causal.push({ connector: c, sentence: sent.text });
    }
  }
}

export function buildPreviousPlotRegistry(previousScenes: readonly Scene[]): PreviousPlotRegistry {
  const signature = previousScenesSignature(previousScenes);
  const cached = prevRegistryCache.get(signature);
  if (cached) return cached;

  const events: Record<string, Stat> = {};
  const entities: Record<string, Stat> = {};
  const causal: Array<{ connector: string; sentence: string }> = [];

  for (const sc of previousScenes) {
    const text = sc.text || '';
    scanEventsInto(text, events);
    scanAllCapsInto(text, entities);
    scanSentenceLevelInto(text, entities, causal);
  }

  const reg: PreviousPlotRegistry = { signature, events, entities, causal };
  prevRegistryCache.set(signature, reg);
  return reg;
}

function summarizeRegistry(reg: PreviousPlotRegistry, maxItems = 8): string[] {
  type Entry = { key: string; count: number; label: string };
  const ev: Entry[] = Object.entries(reg.events).map(([k, v]) => ({ key: k, count: v.count, label: `event:${k}(${v.count})` }));
  const en: Entry[] = Object.entries(reg.entities).map(([k, v]) => ({ key: k, count: v.count, label: `entity:${k}(${v.count})` }));
  const all = [...ev, ...en].sort((a, b) => b.count - a.count).slice(0, maxItems);
  return all.map(e => e.label);
}

function hasRecentCause(sentIndex: number, observations: PlotObservation[], sentences: SentenceSpan[]): boolean {
  const prior = observations.filter(o => o.sentenceIndex === sentIndex - 1);
  if (prior.some(o => o.kind === 'definiteEvent' || o.kind === 'forwardRef')) return true;
  const textPrev = sentences[sentIndex - 1]?.text?.toLowerCase?.() ?? '';
  return /because|since|due to/.test(textPrev);
}

function isWorldEntityAmbiguous(name: string): boolean {
  const isSingleWord = !/\s/.test(name);
  const notAllCaps = !/^[A-Z]{2,}$/.test(name);
  return isSingleWord && notAllCaps;
}

// ---------- Issue generation and candidate assembly ----------
function generateImmediateIssues(
  observations: PlotObservation[],
  registry: PreviousPlotRegistry
): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const knownEvents = new Set(Object.keys(registry.events));
  const isKnownEvent = (head?: string) => !!(head && knownEvents.has(normalizeKey(head)));

  for (const o of observations) {
    if (o.kind === 'definiteEvent' || o.kind === 'forwardRef') {
      if (!isKnownEvent(o.head)) {
        const opening = o.sentenceIndex <= 1;
        issues.push({
          type: 'plot',
          severity: opening ? 'must-fix' : 'should-fix',
          description: `Forward reference: "${o.markerText}" not previously established.`,
          textSpan: [o.start, o.end],
        });
      }
    } else if (o.kind === 'worldEntity') {
      const key = normalizeKey(o.markerText);
      const known = registry.entities[key]?.count > 0;
      if (!known) {
        const opening = o.sentenceIndex <= 1;
        issues.push({
          type: 'plot',
          severity: opening ? 'must-fix' : 'should-fix',
          description: `World-building assumption: "${o.markerText}" appears without prior introduction.`,
          textSpan: [o.start, o.end],
        });
      }
    }
  }
  return issues;
}

function addAmbiguousEventCandidates(cands: PlotCandidate[], defEvents: PlotObservation[], sceneText: string, regSummary: string[]): void {
  const heads = new Set(defEvents.map(o => normalizeKey(o.head ?? '')));
  if (defEvents.length >= 2 && heads.size >= 2) {
    for (const o of defEvents) {
      cands.push({
        markerText: o.markerText,
        sentenceText: o.sentenceText ?? '',
        context: contextSnippet(sceneText, o.start, o.end),
        span: [o.start, o.end],
        sentenceIndex: o.sentenceIndex,
        registrySummary: regSummary,
        otherCues: defEvents.filter(x => x !== o).map(x => x.markerText),
      });
    }
  }
}

function addWorldAmbiguousCandidates(cands: PlotCandidate[], world: PlotObservation[], defEvents: PlotObservation[], sceneText: string, regSummary: string[]): void {
  for (const o of world) {
    if (isWorldEntityAmbiguous(o.markerText)) {
      cands.push({
        markerText: o.markerText,
        sentenceText: o.sentenceText ?? '',
        context: contextSnippet(sceneText, o.start, o.end),
        span: [o.start, o.end],
        sentenceIndex: o.sentenceIndex,
        registrySummary: regSummary,
        otherCues: defEvents.map(x => x.markerText),
      });
    }
  }
}

function addCausalChainCandidates(cands: PlotCandidate[], causal: PlotObservation[], sceneText: string, regSummary: string[]): void {
  const causalBySentence = new Set(causal.map(c => c.sentenceIndex));
  if (causalBySentence.size >= 2) {
    for (const o of causal) {
      cands.push({
        markerText: o.markerText,
        sentenceText: o.sentenceText ?? '',
        context: contextSnippet(sceneText, o.start, o.end),
        span: [o.start, o.end],
        sentenceIndex: o.sentenceIndex,
        registrySummary: regSummary,
        otherCues: causal.filter(x => x !== o).map(x => x.markerText),
      });
    }
  }
}

export function assemblePlotCandidates(
  observations: PlotObservation[],
  registry: PreviousPlotRegistry,
  sceneText: string
): PlotCandidate[] {
  const cands: PlotCandidate[] = [];
  const regSummary = summarizeRegistry(registry);
  const defEvents = observations.filter(o => o.kind === 'definiteEvent');
  const world = observations.filter(o => o.kind === 'worldEntity');
  const causal = observations.filter(o => o.kind === 'causalConnector');

  addAmbiguousEventCandidates(cands, defEvents, sceneText, regSummary);
  addWorldAmbiguousCandidates(cands, world, defEvents, sceneText, regSummary);
  addCausalChainCandidates(cands, causal, sceneText, regSummary);
  return cands;
}

// ---------- Detector implementation ----------
export default class PlotContextDetector extends BaseDetector<PlotCandidate> {
  public readonly detectorType = 'plot' as const;

  protected async localDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    _aiManager: AIServiceManager
  ): Promise<LocalDetectionResult<PlotCandidate>> {
    if (!scene?.text || typeof scene.text !== 'string' || scene.text.trim().length === 0) {
      return { issues: [], requiresAI: false, candidates: [] };
    }

    const doc = await this.prepareDoc(scene.text);
    const sentences = splitSentences(scene.text);
    const registry = buildPreviousPlotRegistry(previousScenes);

    const { observations, eventObs, worldObs, causalObs } = this.collectObservations(scene.text, sentences, registry, doc);
    if (observations.length === 0 && registryIsEmpty(registry)) {
      console.debug('[PlotContextDetector] No observations and empty registry; early exit.');
      return { issues: [], requiresAI: false, candidates: [], stats: { observations: 0 } };
    }

    const { issues, candidates } = this.buildIssuesAndCandidates(scene.text, sentences, observations, registry, eventObs, worldObs, causalObs);

    console.debug('[PlotContextDetector] local counts:', {
      sentences: sentences.length,
      obs: observations.length,
      events: eventObs.length,
      world: worldObs.length,
      causal: causalObs.length,
      issues: issues.length,
      candidates: candidates.length,
    });

    const requiresAI = candidates.length > 0;
    return { issues, requiresAI, candidates, stats: { observations: observations.length } };
  }

  protected async aiDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    candidates: readonly PlotCandidate[]
  ): Promise<ContinuityIssue[]> {
    if (!candidates || candidates.length === 0) return [];
    const summary = (candidates[0]?.registrySummary ?? []).slice(0, 8);
    console.debug('[PlotContextDetector] invoking AI for candidates:', candidates.length);

    const req = this.buildAIRequestComplex(scene, previousScenes, candidates, summary);
    try {
      const resp = await aiManager.analyzeContinuity(req as any);
      const mapped = this.mapAIPlotResponse(resp, candidates, scene.text, summary);
      console.debug('[PlotContextDetector] AI returned plot issues:', mapped.length);
      return mapped;
    } catch (err) {
      console.debug('[PlotContextDetector] AI analyzeContinuity failed; degrading to local-only.', err);
      return [];
    }
  }

  // ---- Local helper methods (keep small) ----
  private async prepareDoc(text: string): Promise<any | null> {
    try {
      const doc = await this.safeNLP(text);
      if (!doc) console.debug('[PlotContextDetector] NLP failed, using regex fallback.');
      return doc;
    } catch {
      console.debug('[PlotContextDetector] NLP failed, using regex fallback.');
      return null;
    }
  }

  private collectObservations(
    text: string,
    sentences: SentenceSpan[],
    registry: PreviousPlotRegistry,
    doc: any | null
  ): { observations: PlotObservation[]; eventObs: PlotObservation[]; worldObs: PlotObservation[]; causalObs: PlotObservation[] } {
    const eventObs = extractEventMentions(text, sentences);
    const worldObs = extractWorldEntitiesCurrent(text, sentences, registry, doc);
    const causalObs = extractCausalConnectors(text, sentences);
    return { observations: [...eventObs, ...worldObs, ...causalObs], eventObs, worldObs, causalObs };
  }

  private buildIssuesAndCandidates(
    sceneText: string,
    sentences: SentenceSpan[],
    observations: PlotObservation[],
    registry: PreviousPlotRegistry,
    eventObs: PlotObservation[],
    _worldObs: PlotObservation[],
    causalObs: PlotObservation[]
  ): { issues: ContinuityIssue[]; candidates: PlotCandidate[] } {
    const issues: ContinuityIssue[] = generateImmediateIssues(observations, registry);
    for (const o of causalObs) {
      const knownCausal = registry.causal.length > 0;
      if (o.sentenceIndex > 0 && !hasRecentCause(o.sentenceIndex, observations, sentences) && !knownCausal) {
        issues.push({
          type: 'plot',
          severity: 'should-fix',
          description: `Causal gap: "${o.markerText}" lacks a stated prior cause.`,
          textSpan: [o.start, o.end],
        });
      }
    }
    const candidates = assemblePlotCandidates(observations, registry, sceneText);
    // Opening forward refs are must-fix already; keep candidates only for ambiguous contexts
    return { issues, candidates };
  }

  // ---- AI helpers (kept small and mock-friendly) ----
  private buildAIRequestComplex(
    scene: Scene,
    previousScenes: readonly Scene[],
    candidates: readonly PlotCandidate[],
    registrySummary: string[]
  ) {
    const headerLines = [
      '[[Plot continuity candidates]]',
      ...candidates.slice(0, 6).map(c => {
        const sent = (c.sentenceText || '').slice(0, 180);
        return `- marker:"${c.markerText}" @[${c.span[0]},${c.span[1]}] | sent:"${sent}" | cues:${c.otherCues.slice(0, 6).join(', ')}`;
      }),
      '[[Previous registry]]',
      registrySummary.slice(0, 8).join(' | '),
      '[[Scene excerpts]]',
    ];
    const header = headerLines.join('\n');

    // Truncate scene near first candidate (~1200 around markers)
    const first = candidates[0]?.span ?? [0, 0];
    const excerpt = contextSnippet(scene.text, first[0], first[1], 600);
    const prevExcerpt = previousScenes.length > 0 ? (previousScenes[previousScenes.length - 1].text || '').slice(0, 800) : '';

    const sceneForAI: Scene = { ...scene, text: `${header}\n\n${excerpt}\n\n[[Prev]]\n${prevExcerpt}` };
    const readerContext: ReaderKnowledge = {
      knownCharacters: new Set<string>(),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: [],
    };
    return {
      scene: sceneForAI,
      previousScenes: previousScenes.slice(-1),
      analysisType: 'complex' as const,
      readerContext,
    };
  }

  private mapAIPlotResponse(
    resp: { issues?: ContinuityIssue[] } | null | undefined,
    candidates: readonly PlotCandidate[],
    sceneText: string,
    registrySummary: string[]
  ): ContinuityIssue[] {
    const candKeys = new Map<string, PlotCandidate>();
    for (const c of candidates) candKeys.set(`${c.span[0]}|${c.span[1]}`, c);

    const out: ContinuityIssue[] = [];
    for (const it of resp?.issues ?? []) {
      const type = it.type ?? 'plot';
      if (type !== 'plot') continue;
      const [s, e] = it.textSpan ?? [NaN, NaN];
      if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) {
        const c = candidates[0];
        out.push({
          type: 'plot',
          severity: it.severity ?? 'should-fix',
          description: (it.description ?? 'Plot/context issue') + (c ? ` [marker:"${c.markerText}" reg:${registrySummary.slice(0, 4).join(', ')}]` : ''),
          textSpan: c ? c.span : [0, Math.min(1, sceneText.length)],
          suggestedFix: it.suggestedFix,
        });
      } else {
        const key = `${s}|${e}`;
        const c = candKeys.get(key);
        out.push({
          type: 'plot',
          severity: it.severity ?? 'should-fix',
          description: (it.description ?? 'Plot/context issue') + (c ? ` [marker:"${c.markerText}" reg:${registrySummary.slice(0, 4).join(', ')}]` : ''),
          textSpan: [s, e],
          suggestedFix: it.suggestedFix,
        });
      }
    }
    return out;
  }
}