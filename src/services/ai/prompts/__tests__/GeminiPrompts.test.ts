import { describe, it, expect } from 'vitest';
import { buildGeminiPrompt } from '../GeminiPrompts';
import type { ReaderKnowledge, Scene } from '../../../../shared/types';

function makeReaderKnowledge(): ReaderKnowledge {
  return {
    knownCharacters: new Set(['Alice', 'Bob']),
    establishedTimeline: [{ label: 'Day 1', when: '2025-01-01' }],
    revealedPlotPoints: ['Alice met Bob'],
    establishedSettings: [{ name: 'Cafe Central', id: 'loc-1' }],
  };
}

function makeScene(id: string, position: number, text = 'Sample scene text.'): Scene {
  return {
    id,
    text,
    wordCount: text.split(/\s+/).length,
    position,
    originalPosition: position,
    characters: ['Alice', 'Bob'],
    timeMarkers: ['later'],
    locationMarkers: ['Cafe Central'],
    hasBeenMoved: false,
    rewriteStatus: 'pending',
  } as Scene;
}

describe('Gemini Prompts - buildGeminiPrompt', () => {
  it('returns deterministic instruction and parts with required sections and JSON-only directive', () => {
    const reader = makeReaderKnowledge();
    const previousScenes = [makeScene('s1', 1, 'Earlier, Alice met Bob.'), makeScene('s2', 2, 'They planned to meet again.')];
    const newPosition = 3;
    const sceneText = 'Alice looks at Bob and wonders what he knows.';
    const { instruction, parts } = buildGeminiPrompt({
      readerContext: reader,
      previousScenes,
      newPosition,
      sceneText,
      genreStyle: 'contemporary',
    });

    // Instruction sections
    expect(instruction).toContain('## Role');
    expect(instruction).toContain('## Reader Knowledge and Previous Scenes');
    expect(instruction).toContain('## Task');
    expect(instruction).toContain(`moved to position ${String(newPosition)}`);
    expect(instruction).toContain('## Reasoning Steps');
    expect(instruction).toContain('## Output Format');
    expect(instruction).toContain('Return ONLY valid JSON');

    // Expected keys/phrases in instruction
    expect(instruction).toContain('issues');
    expect(instruction).toContain('summary');
    expect(instruction).toContain('confidence');
    expect(instruction).toContain('pronoun_reference');
    expect(instruction).toContain('timeline');
    expect(instruction).toContain('character_knowledge');

    // Parts array content
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.length).toBeGreaterThanOrEqual(5);

    const joined = parts.map((p) => p.text).join('\n');

    // Must include derived entries
    expect(joined).toContain('analysis_type: continuity');
    expect(joined).toContain(`scene_position: ${String(newPosition)}`);
    expect(joined).toContain('reader_knowledge: ');
    expect(joined).toContain('previous_scenes: ');
    expect(joined).toContain('scene: ');

    // Ensure data was embedded
    expect(joined).toContain('"knownCharacters":["Alice","Bob"]');
    expect(joined).toContain('"id":"s1"');
    expect(joined).toContain('"id":"s2"');
    expect(joined).toContain(sceneText);
  });
});