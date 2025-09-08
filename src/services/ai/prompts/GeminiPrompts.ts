// Provider-specific prompt templates for Google Gemini

import { ReaderKnowledge, Scene } from '../../../shared/types';

// Local params type (no new global types)
export type BuildGeminiParams = {
  readerContext: ReaderKnowledge;
  previousScenes: Scene[];
  newPosition: number;
  sceneText: string;
  genreStyle?: string;
};

function normalizeReader(reader: ReaderKnowledge) {
  const timeline = (reader.establishedTimeline ?? []).map((t) => ({
    label: t.label,
    when: t.when ?? null,
  }));
  const settings = (reader.establishedSettings ?? []).map((l) => ({
    name: l.name,
    id: l.id ?? null,
  }));
  const knownChars = Array.isArray((reader as any).knownCharacters)
    ? [...(reader as any).knownCharacters]
    : Array.from(reader.knownCharacters ?? []);
  return {
    knownCharacters: knownChars.sort(),
    establishedTimeline: timeline,
    revealedPlotPoints: [...(reader.revealedPlotPoints ?? [])].sort(),
    establishedSettings: settings,
  };
}

function minimalScenes(sc: Scene[]) {
  return (sc ?? []).map((s) => ({
    id: s.id,
    position: s.position,
    originalPosition: s.originalPosition,
    wordCount: s.wordCount,
    hasBeenMoved: s.hasBeenMoved,
  }));
}

/**
 * Build instruction and parts for Gemini's content format.
 * Deterministic, JSON-only output enforced by instruction and (optionally) response_mime_type upstream.
 */
export function buildGeminiPrompt(params: BuildGeminiParams): {
  instruction: string;
  parts: Array<{ text: string }>;
} {
  const reader = normalizeReader(params.readerContext);
  const prevMeta = minimalScenes(params.previousScenes);
  const prevTexts = (params.previousScenes ?? []).map((s) => ({ id: s.id, text: s.text }));

  const instruction = [
    '## Role',
    'You are a deterministic continuity analyst for fiction manuscripts.',
    '',
    '## Reader Knowledge and Previous Scenes',
    'Use reader_knowledge and previous_scenes to evaluate what the reader plausibly knows before the current scene.',
    'Do not invent details that are not present. Prefer concise, evidence-backed reasoning.',
    '',
    '## Task',
    `Analyze continuity of the provided scene when moved to position ${String(params.newPosition)} in the manuscript.`,
    'Identify inconsistencies related to pronouns, timeline, and character knowledge, and any other relevant issues.',
    '',
    '## Reasoning Steps',
    '1) Reader knows: derive facts from reader_knowledge and previous_scenes.',
    '2) Scene reveals: extract key facts from the scene.',
    '3) Conflicts: compare (1) and (2) to find contradictions or missing context; cite minimal evidence.',
    '4) Fixes: propose minimal edits or clarifications for each issue.',
    '',
    '## Output Format',
    'Return ONLY valid JSON. No extra text. No code fences.',
    'Top-level structure:',
    '{',
    '  "issues": [',
    '    {',
    '      "type": "pronoun_reference|timeline|character_knowledge|other",',
    '      "severity": "low|medium|high|critical",',
    '      "span": { "start_index": 0, "end_index": 0 },',
    '      "explanation": "string",',
    '      "evidence": ["string"],',
    '      "suggested_fix": "string",',
    '      "confidence": 0.0',
    '    }',
    '  ],',
    '  "summary": "string",',
    '  "confidence": 0.0',
    '}',
  ].join('\n');

  const rawParts: string[] = [];
  rawParts.push(`analysis_type: continuity`);
  rawParts.push(`scene_position: ${String(params.newPosition)}`);
  if (params.genreStyle) {
    rawParts.push(`genre_style: ${JSON.stringify(params.genreStyle)}`);
  }
  rawParts.push(`reader_knowledge: ${JSON.stringify(reader)}`);
  rawParts.push(`previous_scenes: ${JSON.stringify({ meta: prevMeta, texts: prevTexts })}`);
  rawParts.push(`scene: ${JSON.stringify({ position: params.newPosition, text: params.sceneText })}`);

  const parts = rawParts.map((t) => ({ text: t }));

  return { instruction, parts };
}