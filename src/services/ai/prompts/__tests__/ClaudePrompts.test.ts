import { describe, it, expect } from 'vitest';
import { buildClaudePrompt } from '../ClaudePrompts';
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
  };
}

describe('Claude Prompts - buildClaudePrompt', () => {
  it('produces XML with required tags and strict JSON instructions', () => {
    const reader = makeReaderKnowledge();
    const previousScenes = [makeScene('s1', 1), makeScene('s2', 2)];
    const newPosition = 3;
    const sceneText = 'Alice looks at Bob and wonders what he knows.';

    const prompt = buildClaudePrompt(reader, previousScenes, newPosition, sceneText);

    // Required XML tags
    expect(prompt).toContain('<prompt>');
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('<reader_knowledge>');
    expect(prompt).toContain('<previous_scenes>');
    expect(prompt).toContain('<task>');
    expect(prompt).toContain('<scene');
    expect(prompt).toContain('<thinking>');
    expect(prompt).toContain('<output_format>');

    // JSON contract hints inside output_format
    expect(prompt).toContain('"issues"');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"confidence"');
  });
});