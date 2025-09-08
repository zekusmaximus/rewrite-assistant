// Provider-specific prompt templates for Claude (Anthropic)

import { ReaderKnowledge, Scene } from '../../../shared/types';

/**
 * Build a deterministic XML-style prompt string for Claude.
 * Sections: role, context (reader_knowledge, previous_scenes), task, scene, thinking, output_format
 */
export function buildClaudePrompt(
  readerContext: ReaderKnowledge,
  previousScenes: Scene[],
  newPosition: number,
  sceneText: string,
  genreStyle?: string
): string {
  // Deterministic normalization to ensure stable prompt strings (no randomness)
  const normalizedReader = normalizeReader(readerContext);
  const prevIds = previousScenes.map((s) => s.id);
  const sceneCData = sceneText.includes(']]>')
    ? sceneText.split(']]>').join(']]]]><![CDATA[>')
    : sceneText;

  const xml = [
    '<prompt>',
    '  <role>continuity_analyst</role>',
    '  <context>',
    `    <reader_knowledge>${JSON.stringify(normalizedReader)}</reader_knowledge>`,
    `    <previous_scenes>${JSON.stringify(prevIds)}</previous_scenes>`,
    ...(genreStyle ? [`    <genre_style>${genreStyle}</genre_style>`] : []),
    '  </context>',
    '  <task>Analyze the current scene for continuity issues considering what the reader already knows and the list of previous scenes. Focus on pronoun reference, character knowledge, timeline order, and other continuity conflicts. Identify precise spans and propose minimal, high-quality fixes.</task>',
    `  <scene position="${String(newPosition)}"><![CDATA[${sceneCData}]]></scene>`,
    '  <thinking>',
    '    Perform internal multi-step reasoning but DO NOT include your reasoning in the final output. Use the following checklist silently:',
    '    1) Summarize what the reader plausibly knows so far (reader_knowledge).',
    '    2) Extract what this scene reveals (characters, timeline cues, settings, facts).',
    '    3) Compare for conflicts:',
    '       - Pronoun/reference ambiguities or mismatches',
    '       - Character knowledge violations (knows/doesn’t know yet)',
    '       - Timeline order or elapsed-time inconsistencies',
    '       - Setting/location contradictions or continuity drifts',
    '    4) For each conflict: gather evidence quotes, explain the issue, mark severity, select exact text span indices, and propose a concise fix.',
    '    Final answer must ONLY be the JSON object specified in <output_format> (no extra text).',
    '  </thinking>',
    '  <output_format>',
    'Return ONLY valid JSON. No markdown, no XML, no commentary. Use double quotes on keys/strings. Do not include trailing commas. Follow exactly this shape:',
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
    '  "summary": "string"',
    '}',
    '  </output_format>',
    '</prompt>',
  ].join('\n');

  return xml;
}

function normalizeReader(reader: ReaderKnowledge) {
  const timeline = reader.establishedTimeline.map(
    (t: ReaderKnowledge['establishedTimeline'][number]) => ({
      label: t.label,
      when: t.when ?? null,
    })
  );
  const settings = reader.establishedSettings.map(
    (l: ReaderKnowledge['establishedSettings'][number]) => ({
      name: l.name,
      id: l.id ?? null,
    })
  );
  return {
    knownCharacters: Array.from(reader.knownCharacters).sort(),
    establishedTimeline: timeline,
    revealedPlotPoints: [...reader.revealedPlotPoints].sort(),
    establishedSettings: settings,
  };
}