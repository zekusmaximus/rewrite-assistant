// OpenAI-optimized prompt templates with structured outputs

import { ReaderKnowledge, Scene } from '../../../shared/types';

// Local params type for prompt construction (no new global types)
export type BuildOpenAIParams = {
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

export function buildOpenAIPrompt(params: BuildOpenAIParams): { system: string; user: string } {
  const reader = normalizeReader(params.readerContext);
  const prev = minimalScenes(params.previousScenes);

  const system = [
    '## Role',
    'You are a deterministic continuity analyst for fiction manuscripts.',
    '',
    '## Task',
    'Identify continuity issues in the current scene using the reader context and prior scenes.',
    'Classify issues using the allowed enums only. Provide concise, evidence-backed explanations.',
    '',
    '## Few-shot',
    'User:',
    '{"readerContext":{"knownCharacters":["A"],"establishedTimeline":[],"revealedPlotPoints":[],"establishedSettings":[]},',
    '"previousScenes":[],"newPosition":1,"sceneText":"Sam met Alex. He thanked her.","genreStyle":"contemporary"}',
    'Assistant:',
    '{"issues":[{"type":"pronoun_reference","severity":"medium","span":{"start_index":14,"end_index":26},"explanation":"Ambiguous pronoun \'He\' may refer to Sam or Alex.","evidence":["He thanked her"],"suggested_fix":"Clarify the referent with a name.","confidence":0.8}],"summary":"One pronoun ambiguity detected."}',
    '',
    'User:',
    '{"readerContext":{"knownCharacters":["A"],"establishedTimeline":[{"label":"yesterday"}],"revealedPlotPoints":[],"establishedSettings":[]},',
    '"previousScenes":[],"newPosition":2,"sceneText":"Yesterday it rained. Today it is still yesterday.","genreStyle":"mystery"}',
    'Assistant:',
    '{"issues":[{"type":"timeline","severity":"high","span":{"start_index":28,"end_index":58},"explanation":"Conflicting time markers: Today vs yesterday.","evidence":["Today it is still yesterday"],"suggested_fix":"Align timeline to a single day.","confidence":0.85}],"summary":"One timeline inconsistency detected."}',
    '',
    '## Output Format',
    'Return ONLY valid JSON per the schema.',
    'No markdown. No code fences. No additional text.',
    '',
    'Top-level keys:',
    '{ "issues": Issue[], "summary": string, "confidence?": number }',
  ].join('\n');

  const userParts: string[] = [];
  userParts.push('## Input');
  userParts.push(`analysisType: continuity`);
  userParts.push(`newPosition: ${String(params.newPosition)}`);
  if (params.genreStyle) {
    userParts.push(`genreStyle: ${JSON.stringify(params.genreStyle)}`);
  }
  userParts.push(`readerContext: ${JSON.stringify(reader)}`);
  userParts.push(`previousScenes: ${JSON.stringify(prev)}`);
  userParts.push(`sceneText: ${JSON.stringify(params.sceneText)}`);

  const user = userParts.join('\n');

  return { system, user };
}

// JSON Schema aligned to Zod AnalysisResponseSchema (self-contained)
export function getOpenAIResponseJsonSchema(): Record<string, any> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Continuity Analysis',
    type: 'object',
    additionalProperties: false,
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { enum: ['pronoun_reference', 'timeline', 'character_knowledge', 'other'] },
            severity: { enum: ['low', 'medium', 'high', 'critical'] },
            span: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    start_index: { type: 'integer', minimum: 0 },
                    end_index: { type: 'integer', minimum: 0 },
                  },
                  required: ['start_index', 'end_index'],
                },
                { type: 'null' },
              ],
            },
            explanation: { type: 'string', minLength: 1 },
            evidence: { type: 'array', items: { type: 'string' } },
            suggested_fix: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['type', 'severity', 'explanation'],
        },
      },
      summary: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['issues', 'summary'],
  };
}

export function getOpenAIResponseFormat() {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'continuity_analysis',
      schema: getOpenAIResponseJsonSchema(),
      strict: true,
    },
  };
}