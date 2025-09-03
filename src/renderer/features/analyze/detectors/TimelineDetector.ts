import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import BaseDetector, { LocalDetectionResult } from './BaseDetector';

// ---------- Types (exported testing hooks) ----------
export interface SentenceSpan { text: string; start: number; end: number }

export interface BasicMarker {
  text: string;
  start: number;
  end: number;
  sentenceIndex: number;
}

type MarkerCategory =
  | 'relative'
  | 'absolute'
  | 'time'
  | 'season'
  | 'weekday'
  | 'holiday'
  | 'sequence'
  | 'month';

interface TemporalMarker extends BasicMarker {
  category: MarkerCategory;
  normalized?: string;
  deltaDays?: number | null;
  anchor?: 'morning' | 'afternoon' | 'evening' | 'night' | 'day';
}

export interface PreviousTimelineRegistry {
  lastAnchor: string | null;
  lastDayOffset: number | null; // approximate cumulative day offset
  seasons: Set<string>; // e.g., winter, summer
  months: Set<string>; // e.g., january
  recentSequences: string[]; // e.g., then, after that
  hasMeanwhile: boolean;
}

export interface TimelineDetectionTarget {
  markerText: string;
  sentenceText: string;
  context: string;
  start: number;
  end: number;
  prevSummary: { lastAnchor: string | null; lastDayOffset: number | null; seasons: string[]; months: string[] };
  otherMarkers: string[];
  sentenceIndex: number;
}

// ---------- Constants ----------
const MONTHS = [
  'january','february','march','april','may','june','july','august','september','october','november','december'
];
const WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const SEASONS = ['spring','summer','fall','autumn','winter'];
const HOLIDAYS = ['christmas','new year','new year\'s','easter','thanksgiving','halloween','hanukkah','ramadan','diwali'];
const TIME_OF_DAY = ['dawn','morning','noon','afternoon','dusk','evening','midnight','night','tonight'];
const SEQUENCE_TERMS = ['then','after that','later that day','soon after','meanwhile','at the same time','moments later'];

const RELATIVE_TERMS = [
  'next day','the following day','tomorrow','yesterday','earlier that day','that night','tonight',
  'the previous night','next morning','this morning','last night','later that day'
];

const WEATHER_SEASONAL = ['snow','blizzard','sleet','heatwave','scorching','sweltering','icy','frost','hail'];

// ---------- Module cache ----------
const registryCache: Map<string, PreviousTimelineRegistry> = new Map();

// ---------- Small utilities (&#x2264; 40 lines) ----------
function sig(previous: readonly Scene[]): string {
  return previous.map(s => s.id).join('|');
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function snippet(text: string, start: number, end: number, r = 120): string {
  const s = clamp(start - r, 0, text.length);
  const e = clamp(end + r, 0, text.length);
  return text.slice(s, e).trim();
}

function monthToSeason(month: string): string | null {
  const m = month.toLowerCase();
  if (['december','january','february'].includes(m)) return 'winter';
  if (['march','april','may'].includes(m)) return 'spring';
  if (['june','july','august'].includes(m)) return 'summer';
  if (['september','october','november'].includes(m)) return 'fall';
  return null;
}

export function computeRelativeDelta(phrase: string): number | null {
  const low = phrase.toLowerCase();
  const numMatch = /(\d+)\s+(day|week|month|year)s?\s+(later|earlier|before|after)/i.exec(low);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    const unit = numMatch[2];
    const dir = numMatch[3];
    const mult = unit === 'day' ? 1 : unit === 'week' ? 7 : unit === 'month' ? 30 : 365;
    const sign = (dir === 'later' || dir === 'after') ? 1 : -1;
    return sign * n * mult;
  }
  if (/\b(next day|the following day|tomorrow|next morning)\b/i.test(low)) return 1;
  if (/\b(previous day|yesterday|the previous night|last night)\b/i.test(low)) return -1;
  if (/\b(earlier that day|that night|tonight|this morning|later that day)\b/i.test(low)) return 0;
  return null;
}

function anchorFromPhrase(phrase: string): TemporalMarker['anchor'] | undefined {
  const low = phrase.toLowerCase();
  if (low.includes('morning') || low.includes('dawn') || low.includes('this morning') || low.includes('next morning')) return 'morning';
  if (low.includes('afternoon') || low.includes('noon')) return 'afternoon';
  if (low.includes('evening') || low.includes('dusk')) return 'evening';
  if (low.includes('night') || low.includes('midnight') || low.includes('tonight') || low.includes('last night')) return 'night';
  return undefined;
}

export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  try {
    const re = /[^.!?]+(?:[.!?]+|\n+|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = text.slice(m.index, m.index + m[0].length);
      spans.push({ text: raw.trim(), start: m.index, end: m.index + m[0].length });
    }
  } catch { /* noop */ }
  if (spans.length === 0) spans.push({ text: text, start: 0, end: text.length });
  return spans;
}

function sentenceIndexFor(pos: number, sentences: readonly SentenceSpan[]): number {
  let lo = 0, hi = sentences.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sentences[mid];
    if (pos < s.start) hi = mid - 1;
    else if (pos >= s.end) lo = mid + 1;
    else { ans = mid; break; }
  }
  return ans;
}

// ---------- Marker extraction (compromise + regex) ----------
function pushMatch(
  arr: TemporalMarker[],
  text: string,
  start: number,
  end: number,
  sentences: readonly SentenceSpan[],
  category: MarkerCategory
): void {
  const si = sentenceIndexFor(start, sentences);
  const phrase = text.slice(start, end);
  arr.push({
    text: phrase,
    start,
    end,
    sentenceIndex: si,
    category,
    deltaDays: category === 'relative' ? computeRelativeDelta(phrase) : null,
    anchor: category === 'relative' || category === 'time' ? anchorFromPhrase(phrase) : undefined,
  });
}

function regexFindAll(text: string, re: RegExp, sentences: readonly SentenceSpan[], cat: MarkerCategory, out: TemporalMarker[]) {
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m.index;
    const e = s + m[0].length;
    pushMatch(out, text, s, e, sentences, cat);
  }
}

function extractWithCompromise(doc: any | null, text: string, sentences: readonly SentenceSpan[]): TemporalMarker[] {
  const out: TemporalMarker[] = [];
  if (!doc) return out;
  try {
    const toArr = (sel: any): string[] => (sel && typeof sel.out === 'function') ? (sel.out('array') ?? []) : [];
    const datePhrases: string[] = toArr(doc.match ? doc.match('#Date') : null).concat(toArr(doc.dates ? doc.dates() : null));
    const timePhrases: string[] = toArr(doc.match ? doc.match('#Time') : null);
    const seen = new Set<string>();
    const addStrings = (phrases: string[], cat: MarkerCategory) => {
      for (const p of phrases) {
        const phrase = (p || '').toString().trim();
        if (!phrase) continue;
        if (seen.has(`${cat}|${phrase}`)) continue;
        seen.add(`${cat}|${phrase}`);
        // search within each sentence to avoid duping earlier matches
        for (const s of sentences) {
          const relIdx = s.text.indexOf(phrase);
          if (relIdx >= 0) {
            const start = s.start + relIdx;
            const end = start + phrase.length;
            pushMatch(out, text, start, end, sentences, cat);
            break;
          }
        }
      }
    };
    addStrings(datePhrases, 'absolute');
    addStrings(timePhrases, 'time');
    return out;
  } catch {
    return out;
  }
}

export function extractTemporalMarkers(
  sceneText: string,
  doc: any | null = null
): { markers: BasicMarker[]; sentences: SentenceSpan[] } {
  if (!sceneText || typeof sceneText !== 'string') return { markers: [], sentences: [{ text: '', start: 0, end: 0 }] };
  const sentences = splitSentences(sceneText);
  const tmp: TemporalMarker[] = [];
  // Compromise-based
  const comp = extractWithCompromise(doc, sceneText, sentences);
  tmp.push(...comp);
  // Regex-based relative amounts
  regexFindAll(sceneText, /\b(\d+)\s+(?:day|week|month|year)s?\s+(?:later|earlier|before|after)\b/gi, sentences, 'relative', tmp);
  // Simple relative terms
  regexFindAll(sceneText, new RegExp('\\b(?:' + RELATIVE_TERMS.join('|').replace(/ /g, '\\s+') + ')\\b', 'gi'), sentences, 'relative', tmp);
  // Sequence terms
  regexFindAll(sceneText, new RegExp('\\b(?:' + SEQUENCE_TERMS.join('|').replace(/ /g, '\\s+') + ')\\b', 'gi'), sentences, 'sequence', tmp);
  // Absolute months, weekdays, seasons, holidays, time-of-day, weather
  regexFindAll(sceneText, new RegExp('\\b(?:' + MONTHS.join('|') + ')\\b', 'gi'), sentences, 'month', tmp);
  regexFindAll(sceneText, new RegExp('\\b(?:' + WEEKDAYS.join('|') + ')\\b', 'gi'), sentences, 'weekday', tmp);
  regexFindAll(sceneText, new RegExp('\\b(?:' + SEASONS.join('|') + ')\\b', 'gi'), sentences, 'season', tmp);
  regexFindAll(sceneText, new RegExp('\\b(?:' + HOLIDAYS.join('|') + ')\\b', 'gi'), sentences, 'holiday', tmp);
  regexFindAll(sceneText, new RegExp('\\b(?:' + TIME_OF_DAY.join('|') + ')\\b', 'gi'), sentences, 'time', tmp);
  regexFindAll(sceneText, new RegExp('\\b(?:' + WEATHER_SEASONAL.join('|') + ')\\b', 'gi'), sentences, 'season', tmp);
  // Return as BasicMarker list (testing contract)
  const basics: BasicMarker[] = tmp.map(m => ({ text: m.text, start: m.start, end: m.end, sentenceIndex: m.sentenceIndex }));
  return { markers: basics, sentences };
}

// ---------- Previous registry builder + caching ----------
function getOrBuildRegistry(previous: readonly Scene[]): PreviousTimelineRegistry {
  const s = sig(previous);
  const c = registryCache.get(s);
  if (c) return c;
  const reg = buildPreviousTimelineRegistry(previous);
  registryCache.set(s, reg);
  return reg;
}

export function buildPreviousTimelineRegistry(previousScenes: readonly Scene[]): PreviousTimelineRegistry {
  const seasons = new Set<string>();
  const months = new Set<string>();
  const recentSequences: string[] = [];
  let lastAnchor: string | null = null;
  let cumOffset = 0;
  let hasMeanwhile = false;

  for (const sc of previousScenes) {
    const text = sc.text ?? '';
    const sentences = splitSentences(text);
    const markers = extractWithCompromise(null, text, sentences);
    // Regex fallback markers too
    const all: TemporalMarker[] = [];
    all.push(...markers);
    regexFindAll(text, /\b(\d+)\s+(?:day|week|month|year)s?\s+(?:later|earlier|before|after)\b/gi, sentences, 'relative', all);
    regexFindAll(text, new RegExp('\\b(?:' + RELATIVE_TERMS.join('|').replace(/ /g, '\\s+') + ')\\b', 'gi'), sentences, 'relative', all);
    regexFindAll(text, new RegExp('\\b(?:' + SEQUENCE_TERMS.join('|').replace(/ /g, '\\s+') + ')\\b', 'gi'), sentences, 'sequence', all);
    regexFindAll(text, new RegExp('\\b(?:' + MONTHS.join('|') + ')\\b', 'gi'), sentences, 'month', all);
    regexFindAll(text, new RegExp('\\b(?:' + SEASONS.join('|') + ')\\b', 'gi'), sentences, 'season', all);
    for (const m of all) {
      if (m.category === 'relative' && m.deltaDays != null) {
        cumOffset += m.deltaDays;
        if (m.anchor) lastAnchor = m.anchor;
      }
      if (m.category === 'time' && m.anchor) lastAnchor = m.anchor;
      if (m.category === 'season') seasons.add(m.text.toLowerCase().replace('autumn', 'fall'));
      if (m.category === 'month') {
        const mon = m.text.toLowerCase();
        months.add(mon);
        const seas = monthToSeason(mon);
        if (seas) seasons.add(seas);
      }
      if (m.category === 'sequence') {
        const low = m.text.toLowerCase();
        recentSequences.push(low);
        if (low.includes('meanwhile') || low.includes('at the same time')) hasMeanwhile = true;
      }
    }
  }

  return {
    lastAnchor,
    lastDayOffset: Number.isNaN(cumOffset) ? null : cumOffset,
    seasons,
    months,
    recentSequences: recentSequences.slice(-20),
    hasMeanwhile,
  };
}

// ---------- Detection target assembly (exported) ----------
export function assembleTimelineDetectionTargets(
  markers: readonly BasicMarker[],
  sceneText: string,
  sentences: readonly SentenceSpan[],
  reg: PreviousTimelineRegistry
): TimelineDetectionTarget[] {
  const lowMarkers = markers.map(m => ({ ...m, low: m.text.toLowerCase() }));
  const otherTexts = (skipIdx: number) =>
    lowMarkers.filter((_, i) => i !== skipIdx).slice(0, 6).map(mm => mm.text);

  const targets: TimelineDetectionTarget[] = [];
  const hasMeanwhile = lowMarkers.some(m => m.low.includes('meanwhile') || m.low.includes('at the same time'));
  const relativeCount = lowMarkers.filter(m => /\b(day|week|month|year|morning|night|yesterday|tomorrow|earlier|later)\b/.test(m.low)).length;

  for (let i = 0; i < lowMarkers.length; i++) {
    const m = lowMarkers[i];
    const isAmbiguousSeason =
      (SEASONS.some(s => m.low.includes(s)) && reg.months.size > 0) ||
      (MONTHS.some(mon => m.low.includes(mon)) && reg.seasons.size > 0);

    const triggers =
      hasMeanwhile ||
      relativeCount >= 2 ||
      isAmbiguousSeason ||
      /\bearlier that day\b/.test(m.low);

    if (!triggers) continue;

    const sent = sentences[m.sentenceIndex]?.text ?? '';
    targets.push({
      markerText: m.text,
      sentenceText: sent,
      context: snippet(sceneText, m.start, m.end),
      start: m.start,
      end: m.end,
      prevSummary: {
        lastAnchor: reg.lastAnchor,
        lastDayOffset: reg.lastDayOffset,
        seasons: Array.from(reg.seasons).slice(0, 6),
        months: Array.from(reg.months).slice(0, 6),
      },
      otherMarkers: otherTexts(i),
      sentenceIndex: m.sentenceIndex,
    });
  }
  return targets;
}

// ---------- Local conflict detection ----------
function seasonBucketSet(markers: readonly BasicMarker[]): Set<string> {
  const set = new Set<string>();
  for (const m of markers) {
    const low = m.text.toLowerCase();
    for (const s of SEASONS) if (low.includes(s)) set.add(s === 'autumn' ? 'fall' : s);
    for (const mon of MONTHS) if (low.includes(mon)) {
      const sb = monthToSeason(mon); if (sb) set.add(sb);
    }
    for (const w of WEATHER_SEASONAL) if (low.includes(w)) {
      if (['snow','blizzard','sleet','icy','frost','hail'].some(x => low.includes(x))) set.add('winter');
      if (['heatwave','scorching','sweltering'].some(x => low.includes(x))) set.add('summer');
    }
  }
  return set;
}

function detectTimelineIssues(
  markers: readonly BasicMarker[],
  reg: PreviousTimelineRegistry,
  sceneText: string
): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const lowMarks = markers.map(m => ({ ...m, low: m.text.toLowerCase() }));
  const hasEarlierToday = lowMarks.some(m => m.low.includes('earlier that day'));
  const hasNextMorning = lowMarks.some(m => m.low.includes('next morning'));
  const hasMultiDayJump = lowMarks.some(m => /(\d+)\s+(day|week|month|year)s?\s+(later|after)/.test(m.low));
  const curSeasons = seasonBucketSet(markers);

  // Hard contradiction: "earlier that day" but previous indicates we're past same-day context
  if (hasEarlierToday && (reg.lastDayOffset !== null && reg.lastDayOffset > 0)) {
    const m = lowMarks.find(x => x.low.includes('earlier that day'))!;
    issues.push({
      type: 'timeline',
      severity: 'must-fix',
      description: 'Temporal rewind: "earlier that day" after prior scenes advanced beyond same-day.',
      textSpan: [m.start, m.end],
    });
  }

  // Likely gap: large jump while recent threads suggest simultaneity
  if (reg.hasMeanwhile && hasMultiDayJump) {
    const m = lowMarks.find(x => /(\d+)\s+(day|week|month|year)s?\s+(later|after)/.test(x.low))!;
    issues.push({
      type: 'timeline',
      severity: 'should-fix',
      description: 'Potential gap: multi-day jump despite ongoing "meanwhile" threads in prior scenes.',
      textSpan: [m.start, m.end],
    });
  }

  // Soft contradiction: "next morning" after cumulative offset suggests longer gap context
  if (hasNextMorning && (reg.lastDayOffset !== null && reg.lastDayOffset >= 2)) {
    const m = lowMarks.find(x => x.low.includes('next morning'))!;
    issues.push({
      type: 'timeline',
      severity: 'should-fix',
      description: 'Possible misalignment: "next morning" but earlier scenes imply a multi-day gap.',
      textSpan: [m.start, m.end],
    });
  }

  // Seasonal inconsistency
  const prevSeasons = new Set(Array.from(reg.seasons));
  const winterPrev = prevSeasons.has('winter');
  const summerPrev = prevSeasons.has('summer');
  const winterCur = curSeasons.has('winter');
  const summerCur = curSeasons.has('summer');

  if ((winterPrev && summerCur) || (summerPrev && winterCur)) {
    const m = lowMarks.find(x => seasonBucketSet([x]).size > 0) ?? lowMarks[0];
    issues.push({
      type: 'timeline',
      severity: 'should-fix',
      description: 'Seasonal inconsistency: prior scenes indicate different season without transition.',
      textSpan: [m.start, m.end],
    });
  } else if (curSeasons.size && prevSeasons.size && Array.from(curSeasons).some(s => !prevSeasons.has(s))) {
    const m = lowMarks.find(x => seasonBucketSet([x]).size > 0) ?? lowMarks[0];
    issues.push({
      type: 'timeline',
      severity: 'consider',
      description: 'Seasonal drift detected; consider adding transition context.',
      textSpan: [m.start, m.end],
    });
  }

  return issues;
}

// ---------- AI request helpers ----------
function buildReaderContextMinimal(): ReaderKnowledge {
  return {
    knownCharacters: new Set(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };
}

function buildAIHeader(scene: Scene, targets: readonly TimelineDetectionTarget[], reg: PreviousTimelineRegistry): string {
  const lines: string[] = [];
  lines.push('[[Timeline detection targets]]');
  lines.push(`scene: id=${scene.id} pos=${scene.position}`);
  for (const c of targets.slice(0, 8)) {
    const sent = (c.sentenceText || '').slice(0, 140).replace(/\n+/g, ' ');
    const others = c.otherMarkers.slice(0, 6).join(' | ') || 'none';
    lines.push(`- marker="${c.markerText}" span=[${c.start},${c.end}] sent="${sent}" localMarkers=[${others}]`);
  }
  lines.push('[[Previous registry]]');
  lines.push(`lastAnchor=${reg.lastAnchor ?? 'none'} lastDayOffset=${reg.lastDayOffset ?? 'n/a'}`);
  lines.push(`seasons: ${Array.from(reg.seasons).slice(0, 8).join(' | ')}`);
  lines.push(`months: ${Array.from(reg.months).slice(0, 8).join(' | ')}`);
  lines.push('[[Scene excerpt]]');
  return lines.join('\n');
}

function buildSceneExcerptAroundTargets(text: string, targets: readonly TimelineDetectionTarget[], maxLen = 1200): string {
  if (!targets.length) return text.slice(0, maxLen);
  const parts: string[] = [];
  for (const c of targets) {
    parts.push(snippet(text, c.start, c.end, 220));
    const len = parts.join('\n---\n').length;
    if (len > maxLen) break;
  }
  return parts.join('\n---\n').slice(0, maxLen);
}

function mapAITimelineIssues(
  resp: { issues?: ContinuityIssue[] } | null | undefined,
  sceneText: string,
  targets: readonly TimelineDetectionTarget[]
): ContinuityIssue[] {
  const out: ContinuityIssue[] = [];
  const byMarker = new Map<string, TimelineDetectionTarget>();
  for (const c of targets) byMarker.set(c.markerText.toLowerCase(), c);
 
  for (const it of resp?.issues ?? []) {
    if ((it.type ?? 'timeline') !== 'timeline') continue;
    const hasSpan = Array.isArray(it.textSpan) && Number.isFinite(it.textSpan[0]) && Number.isFinite(it.textSpan[1]);
    if (hasSpan) {
      out.push({
        type: 'timeline',
        severity: it.severity ?? 'should-fix',
        description: it.description ?? 'Timeline consistency issue',
        textSpan: it.textSpan as [number, number],
        suggestedFix: it.suggestedFix,
      });
      continue;
    }
    // Fallback to closest detection target by marker mention
    const key = (it.description ?? '').toLowerCase();
    let chosen: TimelineDetectionTarget | undefined;
    for (const [mk, c] of byMarker) { if (key.includes(mk)) { chosen = c; break; } }
    chosen ??= targets[0];
    const span: [number, number] = chosen ? [chosen.start, chosen.end] : [0, Math.min(1, sceneText.length)];
    out.push({
      type: 'timeline',
      severity: it.severity ?? 'should-fix',
      description: it.description ?? `Timeline issue near "${chosen?.markerText ?? 'marker'}"`,
      textSpan: span,
      suggestedFix: it.suggestedFix,
    });
  }
  return out;
}

// ---------- Detector implementation ----------
export default class TimelineDetector extends BaseDetector<TimelineDetectionTarget> {
  public readonly detectorType = 'timeline' as const;

  protected async localDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    _aiManager: AIServiceManager
  ): Promise<LocalDetectionResult<TimelineDetectionTarget>> {
    if (!scene?.text || typeof scene.text !== 'string' || scene.text.trim().length === 0) {
      return { issues: [], requiresAI: false, targets: [] };
    }
 
    const doc = await this.safeNLP(scene.text);
    if (!doc) console.debug('[TimelineDetector] compromise not available, using regex-only fallback.');
    const sentences = splitSentences(scene.text);
    const extracted = extractTemporalMarkers(scene.text, doc);
    const basicMarkers = extracted.markers;
    const reg = getOrBuildRegistry(previousScenes);
 
    if (basicMarkers.length === 0 && reg.seasons.size === 0 && reg.months.size === 0 && reg.lastDayOffset === null) {
      console.debug('[TimelineDetector] Fast path: no markers and empty registry.');
      return { issues: [], requiresAI: false, targets: [] };
    }
 
    const issues = detectTimelineIssues(basicMarkers, reg, scene.text);
    const targets = assembleTimelineDetectionTargets(basicMarkers, scene.text, sentences, reg);
 
    console.debug(
      '[TimelineDetector] markers:',
      basicMarkers.length,
      'issues:',
      issues.length,
      'targets:',
      targets.length,
      'reg[lastAnchor,lastDayOffset,seasons,months]:',
      reg.lastAnchor,
      reg.lastDayOffset,
      Array.from(reg.seasons).join(','),
      Array.from(reg.months).join(',')
    );
 
    return {
      issues,
      requiresAI: targets.length > 0,
      targets,
      stats: {
        markers: basicMarkers.length,
        seasonsCurrent: seasonBucketSet(basicMarkers).size,
        hasMeanwhilePrev: reg.hasMeanwhile ? 1 : 0,
        targets: targets.length,
      },
    };
  }

  protected async aiDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    targets: readonly TimelineDetectionTarget[]
  ): Promise<ContinuityIssue[]> {
    if (!targets || targets.length === 0) return [];
    try {
      const reg = getOrBuildRegistry(previousScenes);
      const header = buildAIHeader(scene, targets, reg);
      const excerpt = buildSceneExcerptAroundTargets(scene.text, targets, 1200);
      const prevExcerpt = previousScenes.length ? [{ ...previousScenes[previousScenes.length - 1], text: (previousScenes[previousScenes.length - 1].text ?? '').slice(0, 700) }] : [];
 
      const req = {
        scene: { ...scene, text: `${header}\n\n${excerpt}` },
        previousScenes: prevExcerpt as Scene[],
        analysisType: 'consistency' as const,
        readerContext: buildReaderContextMinimal(),
      } as Parameters<AIServiceManager['analyzeContinuity']>[0];
 
      console.debug('[TimelineDetector] invoking AI (consistency) for targets:', targets.length);
      const resp = await aiManager.analyzeContinuity(req);
      const out = mapAITimelineIssues(resp, scene.text, targets);
      console.debug('[TimelineDetector] AI returned timeline issues:', out.length);
      return out;
    } catch (err) {
      console.debug('[TimelineDetector] AI analyzeContinuity failed; degrading to local-only.', err);
      return [];
    }
  }
}