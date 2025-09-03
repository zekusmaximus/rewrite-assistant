/**
 * SemanticHasher
 * 
 * Generates semantic cache keys and provides equivalence checks that are resilient
 * to formatting edits while being sensitive to meaningful content, position, and context.
 * 
 * Test hooks are exposed as public underscore-prefixed methods.
 */

import { createHash } from 'crypto';
import type { Scene, ReaderKnowledge } from '../../shared/types';
import type { CacheKey } from './types';

// Dynamic require helpers to avoid bundler issues in renderer and keep deps optional at this stage.
const dynamicRequire: NodeRequire | null = (() => {
  try {
    // eslint-disable-next-line no-eval
    return eval('require');
  } catch {
    return null;
  }
})();

// Attempt to load compromise dynamically. Fall back to light regex-based extraction if not present.
let nlp: any = null;
try {
  if (dynamicRequire) {
    nlp = dynamicRequire('compromise');
  }
} catch {
  nlp = null;
}

// Utility: stable JSON stringify (sorted object keys for deterministic hashing)
function stableStringify(value: any): string {
  const seen = new WeakSet();
  const sorter = (key: string, val: any) => {
    if (val && typeof val === 'object') {
      if (seen.has(val)) return undefined;
      seen.add(val);
      if (Array.isArray(val)) {
        return val.map((v) => (typeof v === 'object' ? JSON.parse(stableStringify(v)) : v));
      }
      const sorted: Record<string, any> = {};
      Object.keys(val)
        .sort()
        .forEach((k) => {
          // Skip undefined for stability
          const v = (val as any)[k];
          if (v !== undefined) sorted[k] = v;
        });
      return sorted;
    }
    return val;
  };
  return JSON.stringify(value, sorter);
}

// Utility: sha256 hex digest
function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Normalize common Unicode punctuation to ASCII equivalents
function normalizePunctuation(text: string): string {
  if (!text) return '';
  return text
    // quotes
    .replace(/[“”«»„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    // dashes
    .replace(/—|–/g, '-')
    // ellipsis
    .replace(/…/g, '...')
    // other miscellaneous punctuation to spaces for normalization step
    .replace(/[•·►•]/g, ' ');
}

// Remove Markdown/formatting markers that are non-semantic in this context
function stripFormatting(text: string): string {
  if (!text) return '';
  return text.replace(/[*_`~#>\[\](){}|\\]/g, ' ');
}

// Collapse repeated whitespace and punctuation while preserving word order
function collapseNoise(text: string): string {
  return text
    .replace(/[\s\t\r\n]+/g, ' ')
    .replace(/([,.!?;:])\1+/g, '$1')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,.!?;:])(?=\S)/g, '$1 ')
    .trim();
}

// Normalize entity/character names: strip honorifics and lowercase
function normalizeName(name: string): string {
  const cleaned = name
    .replace(/\b(mr|mrs|ms|dr|sir|madam|lady|lord|prof|professor|capt|captain|sgt|sergeant)\.?\b/gi, '')
    .trim();
  return cleaned.toLowerCase();
}

// Basic regex extraction fallback when compromise isn't available
const FALLBACK = {
  extractPeople(text: string): string[] {
    // Heuristic: consecutive Capitalized words treated as names
    const names = new Set<string>();
    const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const candidate = m[1];
      if (candidate.length >= 2) {
        names.add(candidate);
      }
    }
    return Array.from(names);
  },
  extractNouns(text: string): string[] {
    // Heuristic nouns: words longer than 3 not starting with digit; lowercase
    return Array.from(new Set(text.toLowerCase().match(/\b[a-z]{4,}\b/g) || []));
  },
  extractVerbs(_text: string): string[] {
    // We do not have a robust fallback; keep empty to avoid noise
    return [];
  },
  extractTimeline(text: string): string[] {
    const re = /\b(yesterday|today|tomorrow|morning|evening|noon|midnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}(?::\d{2})?\s?(?:am|pm)?)\b/gi;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push(m[0].toLowerCase());
    }
    return Array.from(new Set(out)).sort();
  },
};

function extractPeopleWithCompromise(text: string): string[] {
  try {
    if (!nlp) return FALLBACK.extractPeople(text);
    const doc = nlp(text);
    const people = doc.people().out('array') as string[];
    return Array.from(new Set(people));
  } catch {
    return FALLBACK.extractPeople(text);
  }
}

function extractNounsWithCompromise(text: string): string[] {
  try {
    if (!nlp) return FALLBACK.extractNouns(text);
    const doc = nlp(text);
    const nouns = doc.nouns().out('array') as string[];
    const topics = (doc.topics ? doc.topics().out('array') : []) as string[];
    const all = [...nouns, ...topics].map((s) => s.toLowerCase());
    return Array.from(new Set(all));
  } catch {
    return FALLBACK.extractNouns(text);
  }
}

function extractVerbsWithCompromise(text: string): string[] {
  try {
    if (!nlp) return FALLBACK.extractVerbs(text);
    const doc = nlp(text);
    const verbs = doc.verbs().out('array') as string[];
    return Array.from(new Set(verbs.map((v) => v.toLowerCase())));
  } catch {
    return FALLBACK.extractVerbs(text);
  }
}

function extractTimelineMarkers(text: string): string[] {
  const found: Set<string> = new Set();
  // compromise dates/times
  try {
    if (nlp) {
      const doc = nlp(text);
      if (doc.dates) {
        const dates = doc.dates().out('array') as string[];
        for (const d of dates) found.add(d.toLowerCase());
      }
      if (doc.times) {
        const times = doc.times().out('array') as string[];
        for (const t of times) found.add(t.toLowerCase());
      }
    }
  } catch {
    // ignore
  }
  // supplemental regex
  for (const t of FALLBACK.extractTimeline(text)) found.add(t);
  return Array.from(found).sort();
}

// Build a compact normalized text representation. For long strings, include chunk hashes to keep size small.
function compactNormalizedText(norm: string): string | { chunks: string[] } {
  const LIMIT = 1200;
  if (norm.length <= LIMIT) return norm;
  const seg = Math.floor(LIMIT / 3);
  const first = norm.slice(0, seg);
  const midStart = Math.max(0, Math.floor((norm.length - seg) / 2));
  const middle = norm.slice(midStart, midStart + seg);
  const last = norm.slice(-seg);
  return {
    chunks: [sha256Hex(first), sha256Hex(middle), sha256Hex(last)],
  };
}

export default class SemanticHasher {
  // Public test hooks (underscore prefixed)
  public _hashSceneContent(text: string): string {
    const normalized = collapseNoise(stripFormatting(normalizePunctuation(text || '')).toLowerCase());
    const nouns = extractNounsWithCompromise(normalized).slice(0, 50).sort();
    const verbs = extractVerbsWithCompromise(normalized).slice(0, 25).sort();
    const fingerprint = {
      tokens: nouns,
      verbs,
      normalizedText: compactNormalizedText(normalized),
    };
    return sha256Hex(stableStringify(fingerprint));
  }

  public _hashSceneContext(previousScenes: Scene[], targetPosition: number): string {
    const useAllAsPrev = !previousScenes.some((s) => typeof s.position === 'number' && s.position >= targetPosition);
    const prior = (useAllAsPrev
      ? previousScenes
      : previousScenes.filter((s) => (typeof s.position === 'number' ? s.position < targetPosition : true))
    ).slice(-5);

    const charactersSet: Set<string> = new Set();
    const timelineSet: Set<string> = new Set();
    const plotSet: Set<string> = new Set();
    const priorSceneIds: string[] = [];

    for (const s of prior) {
      if (!s) continue;
      priorSceneIds.push(s.id);
      // Characters: prefer scene.characters; fallback to NLP
      const sceneChars = Array.isArray(s.characters) && s.characters.length > 0 ? s.characters : extractPeopleWithCompromise(s.text || '');
      for (const c of sceneChars) charactersSet.add(normalizeName(c));

      // Timeline: prefer s.timeMarkers; fallback extraction
      const times = Array.isArray(s.timeMarkers) && s.timeMarkers.length > 0 ? s.timeMarkers : extractTimelineMarkers(s.text || '');
      for (const t of times) timelineSet.add((t || '').toLowerCase());

      // Plot items: nouns/proper nouns minus known characters
      const nouns = extractNounsWithCompromise(s.text || '');
      for (const n of nouns) {
        const nn = normalizeName(n);
        if (!charactersSet.has(nn)) plotSet.add(nn);
      }
    }

    const contextObj = {
      characters: Array.from(charactersSet).sort(),
      timeline: Array.from(timelineSet).sort(),
      plot: Array.from(plotSet).sort(),
      priorSceneIds, // keep order limited to last N
    };
    return sha256Hex(stableStringify(contextObj));
  }

  public _hashReaderKnowledge(readerContext: ReaderKnowledge): string {
    try {
      const knownCharacters = Array.from(readerContext.knownCharacters || []).map(normalizeName).sort();
      const establishedTimeline = (readerContext.establishedTimeline || []).map((e) => ({
        label: (e.label || '').toLowerCase().trim(),
        when: e.when || undefined,
      }));
      // Sort by when then label for stability
      establishedTimeline.sort((a, b) => {
        if (a.when && b.when && a.when !== b.when) return a.when < b.when ? -1 : 1;
        if (a.label !== b.label) return a.label < b.label ? -1 : 1;
        return 0;
      });

      const revealedPlotPoints = (readerContext.revealedPlotPoints || []).map((p) => (p || '').toLowerCase().trim()).sort();
      const establishedSettings = (readerContext.establishedSettings || []).map((s) => (s.name || '').toLowerCase().trim()).sort();

      const fingerprint = {
        knownCharacters,
        establishedTimeline,
        revealedPlotPoints,
        establishedSettings,
      };

      return sha256Hex(stableStringify(fingerprint));
    } catch {
      // Fallback to hashing a stable JSON of the raw object (convert Set to Array if present)
      try {
        const raw: any = { ...readerContext };
        if (raw.knownCharacters && raw.knownCharacters instanceof Set) {
          raw.knownCharacters = Array.from(raw.knownCharacters).sort();
        }
        return sha256Hex(stableStringify(raw));
      } catch {
        return sha256Hex('readerContext:unavailable');
      }
    }
  }

  public generateCacheKey(scene: Scene, position: number, previousScenes: Scene[], readerContext: ReaderKnowledge): CacheKey {
    const sceneText = scene.text || '';
    const sceneFingerprint = this._hashSceneContent(sceneText);
    const contextFingerprint = this._hashSceneContext(previousScenes || [], position);
    const readerKnowledgeFingerprint = this._hashReaderKnowledge(readerContext);

    return {
      sceneId: scene.id,
      position,
      semanticSignature: {
        sceneFingerprint,
        contextFingerprint,
        readerKnowledgeFingerprint,
      },
    };
  }

  public areSemanticallyEquivalent(scene1: Scene, scene2: Scene): boolean {
    const f1 = this._hashSceneContent(scene1.text || '');
    const f2 = this._hashSceneContent(scene2.text || '');
    if (f1 !== f2) return false;

    const chars1 = new Set(
      (Array.isArray(scene1.characters) && scene1.characters.length > 0 ? scene1.characters : extractPeopleWithCompromise(scene1.text || '')).map(normalizeName),
    );
    const chars2 = new Set(
      (Array.isArray(scene2.characters) && scene2.characters.length > 0 ? scene2.characters : extractPeopleWithCompromise(scene2.text || '')).map(normalizeName),
    );

    if (chars1.size !== chars2.size) return false;
    for (const c of chars1) if (!chars2.has(c)) return false;

    return true;
  }
}