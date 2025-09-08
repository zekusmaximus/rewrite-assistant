import type { Scene, ContinuityIssue } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import { enrichAnalysisRequest, runAnalysisWithOptionalConsensus } from '../../../../services/ai/consensus/ConsensusAdapter';
import BaseDetector, { LocalDetectionResult } from './BaseDetector';

interface OpeningStats {
  tokenCount150: number;
  avgSentenceLen: number;
  dialogueRatio: number;
  namedEntities: number;
  adverbs: number;
  adjectives: number;
  uniqueProperNouns2: number;
}

interface PreviousSummary {
  characters: string[];
  keyTerms: string[];
}

interface EngagementDetectionTarget {
  hookLine: string;
  firstSentences: string[];
  contextWindow: string;
  openingStats: OpeningStats;
  previousSummary: PreviousSummary;
}

const ADJ_WORDS = new Set([
  'new','young','old','small','large','little','long','short','great','good','bad','happy','sad','dark','bright','cold','warm','quiet','loud','sudden','slow','fast','early'
]);

export function splitSentences(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  try {
    const re = /[^.!?]+(?:[.!?]+|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const seg = text.slice(m.index, m.index + m[0].length);
      out.push({ start: m.index, end: m.index + m[0].length, text: seg.trim() });
    }
  } catch { /* noop */ }
  if (out.length === 0) out.push({ start: 0, end: text.length, text });
  return out;
}

export function extractHookLine(text: string): string {
  const sents = splitSentences(text);
  const first = sents.find(s => s.text.trim().length > 0)?.text ?? '';
  return first.trim().slice(0, 200);
}

function uniqueProperInSentences(text: string, sents: readonly { start: number; end: number }[], count = 2): number {
  const take = sents.slice(0, Math.max(0, Math.min(count, sents.length)));
  const set = new Set<string>();
  for (const s of take) {
    const seg = text.slice(s.start, s.end);
    const m = seg.match(/\b[A-Z][a-z]+\b/g) ?? [];
    m.forEach((t, idx) => { if (idx > 0) set.add(t); });
  }
  return set.size;
}

export function computeOpeningStats(
  text: string,
  firstSentenceSpans: readonly { start: number; end: number; text: string }[],
  nlpDocOrNull: any | null
): OpeningStats {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, 150).join(' ');
  const tokenCount150 = Math.min(words.length, 150);
  const avgSentenceLen = (() => {
    const consider = firstSentenceSpans.slice(0, Math.min(3, firstSentenceSpans.length));
    if (!consider.length) return 0;
    const totals = consider.map(s => (s.text.split(/\s+/).filter(Boolean).length));
    return Math.round((totals.reduce((a, b) => a + b, 0) / consider.length) * 10) / 10;
  })();
  const dialogueRatio = (() => {
    const lines = head.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (!lines.length) return 0;
    const dlg = lines.filter(l => /^["“]/.test(l.trim()) || /\bsaid\b/i.test(l) || /\.\.\./.test(l));
    return Math.round((dlg.length / lines.length) * 100) / 100;
  })();
  const namedEntities = (() => {
    try { return Array.isArray(nlpDocOrNull?.people?.().out?.('array')) ? (nlpDocOrNull.people().out('array') as string[]).length : (head.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []).length; }
    catch { return (head.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []).length; }
  })();
  const adverbs = (head.match(/\b\w+ly\b/g) ?? []).length;
  const adjectives = (() => {
    try { const n = nlpDocOrNull?.adjectives?.()?.out?.('array'); if (Array.isArray(n)) return n.length; } catch {/*noop*/}
    const toks = head.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [];
    return toks.reduce((c, w) => c + (ADJ_WORDS.has(w) ? 1 : 0), 0);
  })();
  const uniqueProperNouns2 = uniqueProperInSentences(text, firstSentenceSpans, 2);
  return { tokenCount150, avgSentenceLen, dialogueRatio, namedEntities, adverbs, adjectives, uniqueProperNouns2 };
}

export function summarizePreviousContext(previousScenes: readonly Scene[]): PreviousSummary {
  const joined = previousScenes.map(s => s.text || '').join('\n').slice(0, 5000);
  const characters = (() => {
    try {
      // Attempt compromise if available
       
      const mod = require('compromise');
      const nlp = (mod?.default ?? mod) as any;
      const doc = typeof nlp === 'function' ? nlp(joined) : null;
      const arr: string[] = doc?.people?.()?.out?.('array') ?? [];
      const uniq = Array.from(new Set(arr.map(s => String(s).trim()).filter(Boolean)));
      return uniq.slice(0, 6);
    } catch {
      const m = joined.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
      const uniq = Array.from(new Set(m));
      return uniq.slice(0, 6);
    }
  })();
  const keyTerms = (() => {
    const caps = (joined.match(/\b[A-Z][a-z]+\b/g) ?? []).map(s => s.trim());
    const stop = new Set(['The','A','An','And','But','Or','If','Then','When','While','After','Before']);
    const freq = new Map<string, number>();
    for (const t of caps) {
      if (stop.has(t)) continue;
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
  })();
  return { characters, keyTerms };
}

export function buildEngagementDetectionTarget(
  scene: Scene,
  previousScenes: readonly Scene[],
  stats: OpeningStats,
  sentences: readonly { start: number; end: number; text: string }[]
): EngagementDetectionTarget {
  const hookLine = extractHookLine(scene.text || '');
  const firstSentences = sentences.slice(0, 3).map(s => s.text.trim());
  const contextWindow = (scene.text || '').slice(0, 900);
  const previousSummary = summarizePreviousContext(previousScenes);
  return { hookLine, firstSentences, contextWindow, openingStats: stats, previousSummary };
}

function findHookSpan(sceneText: string, hookLine: string): [number, number] {
  const trimmed = (hookLine || '').trim();
  if (!trimmed) return [0, Math.min(sceneText.length, 1)];
  const idx = sceneText.indexOf(trimmed);
  if (idx >= 0) return [idx, idx + trimmed.length];
  return [0, Math.min(sceneText.length, Math.max(1, trimmed.length))];
}

function deriveSeverity(desc?: string): ContinuityIssue['severity'] {
  const d = (desc || '').toLowerCase();
  if (/(no|weak)\s+hook|no\s+conflict|los(e|ing)\s+reader|very\s+slow\s+pacing/.test(d)) return 'must-fix';
  if (/moderate|somewhat\s+slow|dense\s+exposition|confusing\s+load|could\s+be\s+tighter/.test(d)) return 'should-fix';
  return 'consider';
}

function mapAIEngagementIssues(
  resp: { issues?: ContinuityIssue[] } | null | undefined,
  sceneText: string,
  hookLine: string
): ContinuityIssue[] {
  const out: ContinuityIssue[] = [];
  const fallbackSpan = findHookSpan(sceneText, hookLine);
  for (const it of resp?.issues ?? []) {
    const hasSpan = Array.isArray(it.textSpan) && Number.isFinite(it.textSpan[0]) && Number.isFinite(it.textSpan[1]);
    out.push({
      type: 'engagement',
      severity: (it.severity as any) || deriveSeverity(it.description),
      description: it.description ?? 'Engagement issue detected in opening.',
      textSpan: (hasSpan ? (it.textSpan as [number, number]) : fallbackSpan),
      suggestedFix: it.suggestedFix
    });
  }
  return out;
}

function buildReaderContextFromSummary(sum: PreviousSummary) {
  return {
    knownCharacters: new Set(sum.characters),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: []
  };
}

function buildAIHeader(scene: Scene, cand: EngagementDetectionTarget): string {
  const s = cand.openingStats;
  const parts: string[] = [];
  parts.push('[[Engagement assessment request]]');
  parts.push(`scene: id=${scene.id} pos=${scene.position}`);
  parts.push(`hook: "${cand.hookLine.slice(0, 160).replace(/\n+/g, ' ')}"`);
  parts.push(`openingStats: token150=${s.tokenCount150} avgSentLen=${s.avgSentenceLen} dialogRatio=${s.dialogueRatio} ents=${s.namedEntities} adv=${s.adverbs} adj=${s.adjectives} proper2=${s.uniqueProperNouns2}`);
  parts.push('Assess:');
  parts.push('- Opening hook clarity/strength');
  parts.push('- Early tension/conflict presence');
  parts.push('- Pacing in first ~700–900 chars');
  parts.push('- Character introduction load and clarity');
  const chars = cand.previousSummary.characters.join(', ');
  const terms = cand.previousSummary.keyTerms.join(', ');
  parts.push(`prevContext: chars=[${chars}] key=[${terms}]`);
  return parts.join('\n');
}

export default class EngagementDetector extends BaseDetector<EngagementDetectionTarget> {
  public readonly detectorType = 'engagement' as const;

  protected async localDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    _aiManager: AIServiceManager
  ): Promise<LocalDetectionResult<EngagementDetectionTarget>> {
    if (!scene?.text || scene.text.trim().length === 0) {
      return { issues: [], requiresAI: false, targets: [] };
    }
    const doc = await this.safeNLP(scene.text);
    const sentences = splitSentences(scene.text);
    const stats = computeOpeningStats(scene.text, sentences, doc);
    const target = buildEngagementDetectionTarget(scene, previousScenes, stats, sentences);
    const targets = target.hookLine ? [target] : [];
    console.debug('[EngagementDetector] stats/target:', { stats, hasTarget: targets.length > 0 });
    return {
      issues: [],
      requiresAI: targets.length > 0,
      targets,
      stats: stats as unknown as Record<string, number>
    };
  }

  protected async aiDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    targets: readonly EngagementDetectionTarget[]
  ): Promise<ContinuityIssue[]> {
    if (!targets || targets.length === 0) return [];
    const cand = targets[0];
    try {
      const header = buildAIHeader(scene, cand);
      const body: string[] = [];
      body.push('[[First sentences]]');
      for (const s of cand.firstSentences) body.push(`- ${s}`);
      body.push('[[Scene context (~900 chars)]]');
      body.push(cand.contextWindow);
      const textPayload = `${header}\n\n${body.join('\n')}`;
      const lastPrev = previousScenes.slice(-1).map(s => ({ ...s, text: (s.text ?? '').slice(0, 600) }));
      const baseReq = {
        scene: { ...scene, text: textPayload },
        previousScenes: lastPrev as Scene[],
        analysisType: 'full' as const,
        readerContext: buildReaderContextFromSummary(cand.previousSummary)
      } as Parameters<AIServiceManager['analyzeContinuity']>[0];

      const enriched = enrichAnalysisRequest(baseReq as any, {
        scene,
        detectorType: 'engagement',
        flags: { critical: Boolean((scene as any)?.critical) },
      });

      console.debug('[EngagementDetector] invoking AI (full) for detection targets');
      const { issues } = await runAnalysisWithOptionalConsensus(aiManager, enriched as any, {
        critical: Boolean((enriched as any)?.flags?.critical),
        consensusCount: 2,
        acceptThreshold: 0.5,
        humanReviewThreshold: 0.9,
        maxModels: 2,
      });

      const out = mapAIEngagementIssues({ issues }, scene.text, cand.hookLine);
      console.debug('[EngagementDetector] AI returned engagement issues:', out.length);
      return out;
    } catch (err) {
      console.debug('[EngagementDetector] AI analyzeContinuity failed; returning empty.', err);
      return [];
    }
  }
}