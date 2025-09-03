import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import BaseDetector, { LocalDetectionResult } from './BaseDetector';

/**
 * Character continuity detector (Detector 2 - Phase 2):
 * - Local NLP via compromise (safe) + regex fallback
 * - Previous character registry caching and alias handling
 * - Immediate local issues for missing/weak intros and relationship assumptions
 * - Selective AI validation (analysisType "consistency") for adequacy/ambiguity
 */

// ---------- Internal & exported types ----------
export interface NameOccurrence {
  name: string;
  start: number;
  end: number;
  sentenceIndex: number;
  isFull: boolean;
  isFirstOnly: boolean;
  hasApposition: boolean;
  nickname?: string;
}

export interface PreviousRegistry {
  canonical: Set<string>;
  aliases: Map<string, Set<string>>; // key: canonical, value: alias set
}

export interface CharacterDetectionTarget {
  characterName: string;
  aliasNames: string[];
  firstOccurrence: [number, number];
  sentenceText: string;
  context: string;
  prevRegistry: { canonical: string[]; aliases: string[] };
  relationshipTerms: string[];
  sentenceIndex: number;
}

// ---------- Module state ----------
const registryCache: Map<string, PreviousRegistry> = new Map();

// ---------- Small utilities (kept <= 40 lines) ----------
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function signature(previous: readonly Scene[]): string {
  return previous.map(s => s.id).join('|');
}

function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  try {
    const re = /[^.!?]+(?:[.!?]+|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const seg = text.slice(m.index, m.index + m[0].length);
      out.push({ text: seg.trim(), start: m.index, end: m.index + m[0].length });
    }
  } catch {/* noop */}
  if (out.length === 0) out.push({ text, start: 0, end: text.length });
  return out;
}

function toLowerSet(iter: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const v of iter) s.add(v.toLowerCase());
  return s;
}

function appositionAfter(text: string, end: number): boolean {
  const seg = text.slice(end, Math.min(text.length, end + 40));
  return /(,\s*(the|a|an)\s+[a-z-]{2,})|(\s+who\s+)/i.test(seg);
}

function contextSnippet(text: string, start: number, end: number, radius = 120): string {
  const s = Math.max(0, start - radius);
  const e = Math.min(text.length, end + radius);
  return text.slice(s, e).trim();
}

function flattenAliases(reg: PreviousRegistry): Set<string> {
  const flat = new Set<string>();
  for (const set of reg.aliases.values()) for (const a of set) flat.add(a);
  return flat;
}

function firstLastTokens(full: string): { first?: string; last?: string } {
  const parts = full.split(/\s+/).filter(Boolean);
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : undefined };
}

function titleStripped(name: string): string {
  return name.replace(/\b(?:Dr|Mr|Mrs|Ms|Miss)\.\s*/g, '').trim();
}

const REL_TERMS = [
  'as usual','like before','as she told him','as he told her','back at it','you know',
  'sis','bro','honey','dear','sweetie','buddy','pal'
];

const PRONOUNS = ['he','she','him','her','his','hers','they','them','their','theirs'];

const NAME_FALLBACK_RE = /\b(?:Dr|Mr|Mrs|Ms|Miss)\.\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;

const NAME_STOP = new Set([
  'The','A','An','And','But','Or','If','Then','When','While','After','Before',
  'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday',
  'January','February','March','April','May','June','July','August','September','October','November','December'
]);

// ---------- Required exports (testing hooks) ----------
export function buildPreviousRegistry(previousScenes: readonly Scene[]): PreviousRegistry {
  const canonical = new Set<string>();
  const aliases = new Map<string, Set<string>>();
  const addAlias = (canon: string, a: string | undefined) => {
    if (!a) return;
    const key = canon;
    const set = aliases.get(key) ?? new Set<string>();
    set.add(a);
    aliases.set(key, set);
  };

  for (const sc of previousScenes) {
    let m: RegExpExecArray | null;
    const text = sc.text ?? '';
    while ((m = NAME_FALLBACK_RE.exec(text)) !== null) {
      const raw = m[0].trim();
      const nm = raw;
      if (!nm) continue;
      const stripped = titleStripped(nm);
      const tok0 = stripped.split(/\s+/)[0];
      if (!tok0 || NAME_STOP.has(tok0)) continue;
      canonical.add(stripped);
      const { first, last } = firstLastTokens(stripped);
      addAlias(stripped, first);
      addAlias(stripped, last);
    }
    // nickname patterns: First "Nick" Last OR First (Nick) Last
    const nickRe = /\b([A-Z][a-z]+)\s+(?:"([^"]+)"|\(([^)]+)\))\s+([A-Z][a-z]+)\b/g;
    let nm: RegExpExecArray | null;
    while ((nm = nickRe.exec(text)) !== null) {
      const canon = `${nm[1]} ${nm[4]}`;
      canonical.add(canon);
      const nick = (nm[2] ?? nm[3] ?? '').trim();
      if (nick) addAlias(canon, nick);
      addAlias(canon, nm[1]);
      addAlias(canon, nm[4]);
    }
  }
  return { canonical, aliases };
}

export function extractSceneNames(sceneText: string): NameOccurrence[] {
  const sentences = splitSentences(sceneText);
  const seen = new Set<string>();
  const out: NameOccurrence[] = [];
  let m: RegExpExecArray | null;
  while ((m = NAME_FALLBACK_RE.exec(sceneText)) !== null) {
    const raw = m[0].trim();
    const nm = raw;
    if (!nm) continue;
    const stripped = titleStripped(nm);
    const tok0 = stripped.split(/\s+/)[0];
    if (!tok0 || NAME_STOP.has(tok0)) continue;
    if (seen.has(stripped)) continue;
    seen.add(stripped);
    const start = m.index;
    const end = start + m[0].length;
    let si = sentences.findIndex(s => start >= s.start && start < s.end);
    if (si < 0) si = 0;
    const isFull = /\s/.test(stripped);
    const isFirstOnly = !isFull;
    out.push({ name: stripped, start, end, sentenceIndex: si, isFull, isFirstOnly, hasApposition: appositionAfter(sceneText, end) });
  }
  return out;
}

export function findFirstMentionOffsets(name: string, sceneText: string, fromIndex?: number): [number, number] {
  const nm = escapeRegExp(name);
  const re = new RegExp(`\\b${nm}\\b`);
  const idx = re.exec(sceneText.slice(fromIndex ?? 0))?.index;
  if (idx === undefined) return [-1, -1];
  const start = (fromIndex ?? 0) + idx;
  return [start, start + name.length];
}

export function detectRelationshipTerms(sentenceText: string): string[] {
  const low = sentenceText.toLowerCase();
  const found: string[] = [];
  for (const t of REL_TERMS) {
    if (low.includes(t)) found.push(t);
  }
  return found;
}

export function prepareDetectionTargets(
  names: readonly NameOccurrence[],
  sceneText: string,
  sentences: readonly { text: string; start: number; end: number }[],
  reg: PreviousRegistry
): CharacterDetectionTarget[] {
  const cset = toLowerSet(reg.canonical);
  const aset = toLowerSet(flattenAliases(reg));
  const targets: CharacterDetectionTarget[] = [];
  for (const n of names) {
    const low = n.name.toLowerCase();
    const known = n.isFull ? cset.has(low) : aset.has(low);
    if (!known && (n.isFirstOnly || n.nickname) && !n.hasApposition) {
      const sent = sentences[n.sentenceIndex]?.text ?? '';
      targets.push({
        characterName: n.name,
        aliasNames: Array.from(new Set([firstLastTokens(n.name).first, firstLastTokens(n.name).last, n.nickname].filter(Boolean) as string[])),
        firstOccurrence: [n.start, n.end],
        sentenceText: sent,
        context: contextSnippet(sceneText, n.start, n.end),
        prevRegistry: {
          canonical: Array.from(reg.canonical).slice(0, 6),
          aliases: Array.from(flattenAliases(reg)).slice(0, 6),
        },
        relationshipTerms: detectRelationshipTerms(sent),
        sentenceIndex: n.sentenceIndex,
      });
    }
  }
  return targets;
}

// ---------- Internal helpers for local analysis ----------
function getOrBuildRegistry(previous: readonly Scene[]): PreviousRegistry {
  const sig = signature(previous);
  const cached = registryCache.get(sig);
  if (cached) return cached;
  const reg = buildPreviousRegistry(previous);
  registryCache.set(sig, reg);
  return reg;
}

function compileCurrentNamesWithCompromise(sceneText: string, doc: any | null): NameOccurrence[] {
  if (!doc || typeof doc.people !== 'function') return extractSceneNames(sceneText);
  try {
    const arr: string[] = doc.people().out('array') ?? [];
    const uniq = Array.from(new Set(arr.filter(s => s && typeof s === 'string').map(s => s.trim()).filter(Boolean)));
    const sentences = splitSentences(sceneText);
    const out: NameOccurrence[] = [];
    for (const nm of uniq) {
      const [start, end] = findFirstMentionOffsets(nm, sceneText);
      if (start < 0) continue;
      let si = sentences.findIndex(s => start >= s.start && start < s.end);
      if (si < 0) si = 0;
      const stripped = titleStripped(nm);
      const isFull = /\s/.test(stripped);
      out.push({
        name: stripped,
        start,
        end,
        sentenceIndex: si,
        isFull,
        isFirstOnly: !isFull,
        hasApposition: appositionAfter(sceneText, end),
      });
    }
    return out.length ? out : extractSceneNames(sceneText);
  } catch {
    return extractSceneNames(sceneText);
  }
}

function prevTextContainsRelation(previous: readonly Scene[], name: string, term: string): boolean {
  const hay = previous.map(s => s.text || '').join('\n').toLowerCase();
  return hay.includes(name.toLowerCase()) && hay.includes(term.toLowerCase());
}

function findOpeningPronouns(sceneText: string, sentences: readonly { start: number; end: number }[], maxSentence = 2) {
  const limitEnd = sentences[Math.min(maxSentence - 1, sentences.length - 1)]?.end ?? Math.min(sceneText.length, 240);
  const text = sceneText.slice(0, limitEnd);
  const re = new RegExp(`\\b(${PRONOUNS.join('|')})\\b`, 'gi');
  const list: { pronoun: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m.index;
    list.push({ pronoun: m[0].toLowerCase(), start: s, end: s + m[0].length });
  }
  return list;
}

// ---------- AI request/response helpers ----------
function buildReaderContext(names: readonly string[]): ReaderKnowledge {
  return {
    knownCharacters: new Set(names),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };
}

function registryKnownNames(reg: PreviousRegistry): string[] {
  return Array.from(reg.canonical);
}

function buildAIHeader(scene: Scene, targets: readonly CharacterDetectionTarget[], reg: PreviousRegistry): string {
  const lines: string[] = [];
  lines.push('[[Character detection targets]]');
  lines.push(`scene: id=${scene.id} pos=${scene.position}`);
  const chosen = targets.slice(0, 8);
  for (const c of chosen) {
    const sent = (c.sentenceText || '').slice(0, 140).replace(/\n+/g, ' ');
    const aliases = c.aliasNames.slice(0, 4).join(', ') || 'none';
    const rel = c.relationshipTerms.slice(0, 4).join(', ') || 'none';
    lines.push(`- name="${c.characterName}" span=[${c.firstOccurrence[0]},${c.firstOccurrence[1]}] sent="${sent}" aliases=[${aliases}] rel=[${rel}]`);
  }
  lines.push('[[Previous registry summary]]');
  lines.push(`canonical: ${Array.from(reg.canonical).slice(0, 8).join(' | ')}`);
  lines.push(`aliases: ${Array.from(flattenAliases(reg)).slice(0, 10).join(' | ')}`);
  lines.push('[[Scene excerpt]]');
  return lines.join('\n');
}

function buildSceneExcerpt(text: string, targets: readonly CharacterDetectionTarget[], maxLen = 1200): string {
  if (!targets.length) return text.slice(0, maxLen);
  const snippets: string[] = [];
  const used: [number, number][] = [];
  for (const c of targets) {
    const [s, e] = c.firstOccurrence;
    const snip = contextSnippet(text, s, e, 220);
    if (!snip) continue;
    snippets.push(snip);
    used.push([s, e]);
    const len = snippets.join('\n---\n').length;
    if (len > maxLen) break;
  }
  const out = snippets.join('\n---\n');
  return out.slice(0, maxLen);
}

function mapAICharacterIssues(
  resp: { issues?: ContinuityIssue[] } | null | undefined,
  sceneText: string,
  targets: readonly CharacterDetectionTarget[]
): ContinuityIssue[] {
  const byName = new Map<string, CharacterDetectionTarget>();
  for (const c of targets) byName.set(c.characterName.toLowerCase(), c);
  const out: ContinuityIssue[] = [];
  for (const it of resp?.issues ?? []) {
    if ((it.type ?? 'character') !== 'character') continue;
    const hasSpan = Array.isArray(it.textSpan) && Number.isFinite(it.textSpan[0]) && Number.isFinite(it.textSpan[1]);
    if (hasSpan) {
      out.push({
        type: 'character',
        severity: it.severity ?? 'should-fix',
        description: it.description ?? 'Character introduction/relationship adequacy issue',
        textSpan: it.textSpan as [number, number],
        suggestedFix: it.suggestedFix,
      });
      continue;
    }
    // Fallback: attach to detection target first occurrence by name if present
    const key = (it.description ?? '').toLowerCase();
    let chosen = null as CharacterDetectionTarget | null;
    for (const [nm, c] of byName) {
      if (key.includes(nm)) { chosen = c; break; }
    }
    chosen ??= targets[0] ?? null;
    const span: [number, number] = chosen ? chosen.firstOccurrence : [0, Math.min(1, sceneText.length)];
    out.push({
      type: 'character',
      severity: it.severity ?? 'should-fix',
      description: it.description ?? `Character adequacy issue: ${chosen?.characterName ?? 'unknown'}`,
      textSpan: span,
      suggestedFix: it.suggestedFix,
    });
  }
  return out;
}

// ---------- Local assessment helpers (<= 40 lines each) ----------
function assessFirstAppearanceIssues(
  currentNames: readonly NameOccurrence[],
  reg: PreviousRegistry
): { issues: ContinuityIssue[]; unknownFirstMentions: number } {
  const issues: ContinuityIssue[] = [];
  let count = 0;
  const canSet = toLowerSet(reg.canonical);
  const aliSet = toLowerSet(flattenAliases(reg));
  for (const n of currentNames) {
    const low = n.name.toLowerCase();
    const known = n.isFull ? canSet.has(low) : aliSet.has(low);
    if (!known && (n.isFirstOnly || n.nickname) && !n.hasApposition) {
      count++;
      issues.push({
        type: 'character',
        severity: n.sentenceIndex <= 1 ? 'must-fix' : 'should-fix',
        description: `First mention "${n.name}" appears without introduction/background.`,
        textSpan: [n.start, n.end],
      });
    }
  }
  return { issues, unknownFirstMentions: count };
}

function assessRelationshipAssumptions(
  sentences: readonly { text: string; start: number; end: number }[],
  currentNames: readonly NameOccurrence[],
  previousScenes: readonly Scene[]
): { issues: ContinuityIssue[]; relTermsFound: number } {
  const issues: ContinuityIssue[] = [];
  let relTermsFound = 0;
  for (const sent of sentences) {
    const terms = detectRelationshipTerms(sent.text);
    if (!terms.length) continue;
    const anyNameHere = currentNames.some(n => n.start >= sent.start && n.start < sent.end);
    if (!anyNameHere) continue;
    relTermsFound += terms.length;
    const nameInSent = currentNames.find(n => n.start >= sent.start && n.start < sent.end)?.name;
    const supported = nameInSent ? terms.some(t => prevTextContainsRelation(previousScenes, nameInSent, t)) : false;
    if (!supported) {
      const t0 = terms[0];
      const off = sent.text.toLowerCase().indexOf(t0);
      const begin = off >= 0 ? sent.start + off : sent.start;
      const end = off >= 0 ? begin + t0.length : Math.min(sent.end, begin + 4);
      issues.push({
        type: 'character',
        severity: 'should-fix',
        description: `Relationship assumption "${t0}" with ${nameInSent ?? 'a character'} may lack prior support.`,
        textSpan: [begin, end],
      });
    }
  }
  return { issues, relTermsFound };
}

function assessPronounBeforeNaming(
  sceneText: string,
  sentences: readonly { start: number; end: number }[],
  currentNames: readonly NameOccurrence[],
  reg: PreviousRegistry
): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const canSet = toLowerSet(reg.canonical);
  const aliSet = toLowerSet(flattenAliases(reg));
  const openingPronouns = findOpeningPronouns(sceneText, sentences, 2);
  if (!openingPronouns.length) return issues;
  const earliestUnknown = currentNames
    .filter(n => {
      const low = n.name.toLowerCase();
      const known = n.isFull ? canSet.has(low) : aliSet.has(low);
      return !known;
    })
    .sort((a, b) => a.sentenceIndex - b.sentenceIndex)[0];
  if (earliestUnknown && earliestUnknown.sentenceIndex >= 2) {
    const p0 = openingPronouns[0];
    issues.push({
      type: 'character',
      severity: 'should-fix',
      description: `Early pronoun reference precedes first naming of a new character "${earliestUnknown.name}".`,
      textSpan: [p0.start, p0.end],
    });
  }
  return issues;
}
// ---------- Detector implementation ----------
export default class CharacterDetector extends BaseDetector<CharacterDetectionTarget> {
  public readonly detectorType = 'character' as const;

  protected async localDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    _aiManager: AIServiceManager
  ): Promise<LocalDetectionResult<CharacterDetectionTarget>> {
    if (!scene?.text || typeof scene.text !== 'string' || scene.text.trim().length === 0) {
      return { issues: [], requiresAI: false, targets: [] };
    }

    const doc = await this.safeNLP(scene.text);
    const sentences = splitSentences(scene.text);
    const currentNames = compileCurrentNamesWithCompromise(scene.text, doc);
    const reg = getOrBuildRegistry(previousScenes);
    const canSet = toLowerSet(reg.canonical);
    const aliSet = toLowerSet(flattenAliases(reg));

    let unknownFirstMentions = 0;
    let relTermsFound = 0;
    const issues: ContinuityIssue[] = [];

    // First-appearance without intro
    for (const n of currentNames) {
      const low = n.name.toLowerCase();
      const known = n.isFull ? canSet.has(low) : aliSet.has(low);
      if (!known && (n.isFirstOnly || n.nickname) && !n.hasApposition) {
        unknownFirstMentions++;
        const sev: ContinuityIssue['severity'] = n.sentenceIndex <= 1 ? 'must-fix' : 'should-fix';
        issues.push({
          type: 'character',
          severity: sev,
          description: `First mention "${n.name}" appears without introduction/background.`,
          textSpan: [n.start, n.end],
        });
      }
    }

    // Relationship assumptions
    for (const sent of sentences) {
      const terms = detectRelationshipTerms(sent.text);
      if (!terms.length) continue;
      const anyNameHere = currentNames.some(n => n.start >= sent.start && n.start < sent.end);
      if (!anyNameHere) continue;
      relTermsFound += terms.length;
      // If no evidence in previous scenes, flag should-fix
      const nameInSent = currentNames.find(n => n.start >= sent.start && n.start < sent.end)?.name;
      const supported = nameInSent ? terms.some(t => prevTextContainsRelation(previousScenes, nameInSent, t)) : false;
      if (!supported) {
        const t0 = terms[0];
        const off = sent.text.toLowerCase().indexOf(t0);
        const begin = off >= 0 ? sent.start + off : sent.start;
        const end = off >= 0 ? begin + t0.length : Math.min(sent.end, begin + 4);
        issues.push({
          type: 'character',
          severity: 'should-fix',
          description: `Relationship assumption "${t0}" with ${nameInSent ?? 'a character'} may lack prior support.`,
          textSpan: [begin, end],
        });
      }
    }

    // Pronouns before naming (approximate)
    const openingPronouns = findOpeningPronouns(scene.text, sentences, 2);
    if (openingPronouns.length) {
      const earliestUnknown = currentNames
        .filter(n => {
          const low = n.name.toLowerCase();
          const known = n.isFull ? canSet.has(low) : aliSet.has(low);
          return !known;
        })
        .sort((a, b) => a.sentenceIndex - b.sentenceIndex)[0];
      if (earliestUnknown && earliestUnknown.sentenceIndex >= 2) {
        const p0 = openingPronouns[0];
        issues.push({
          type: 'character',
          severity: 'should-fix',
          description: `Early pronoun reference precedes first naming of a new character "${earliestUnknown.name}".`,
          textSpan: [p0.start, p0.end],
        });
      }
    }

    const targets = prepareDetectionTargets(currentNames, scene.text, sentences, reg);
    console.debug('[CharacterDetector] names:', currentNames.length, 'unknownFirst:', unknownFirstMentions, 'relTerms:', relTermsFound, 'targets:', targets.length);

    return {
      issues,
      requiresAI: targets.length > 0,
      targets,
      stats: {
        namesFound: currentNames.length,
        unknownFirstMentions,
        relTermsFound,
        targets: targets.length,
      },
    };
  }

  protected async aiDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    targets: readonly CharacterDetectionTarget[]
  ): Promise<ContinuityIssue[]> {
    if (!targets || targets.length === 0) return [];
    try {
      const reg = getOrBuildRegistry(previousScenes);
      const header = buildAIHeader(scene, targets, reg);
      const excerpt = buildSceneExcerpt(scene.text, targets, 1200);
      const lastPrev = previousScenes.slice(-1).map(s => ({ ...s, text: (s.text ?? '').slice(0, 800) }));
      const req = {
        scene: { ...scene, text: `${header}\n\n${excerpt}` },
        previousScenes: lastPrev as Scene[],
        analysisType: 'consistency' as const,
        readerContext: buildReaderContext(registryKnownNames(reg)),
      } as Parameters<AIServiceManager['analyzeContinuity']>[0];

      console.debug('[CharacterDetector] invoking AI (consistency) for targets:', targets.length);
      const resp = await aiManager.analyzeContinuity(req);
      const out = mapAICharacterIssues(resp, scene.text, targets);
      console.debug('[CharacterDetector] AI returned character issues:', out.length);
      return out;
    } catch (err) {
      console.debug('[CharacterDetector] AI analyzeContinuity failed; degrading to local-only.', err);
      return [];
    }
  }
}