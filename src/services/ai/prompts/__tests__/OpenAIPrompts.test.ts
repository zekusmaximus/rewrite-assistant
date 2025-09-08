import { describe, it, expect } from 'vitest';
import { buildOpenAIPrompt, getOpenAIResponseJsonSchema, getOpenAIResponseFormat } from '../OpenAIPrompts';
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

describe('OpenAI Prompts - buildOpenAIPrompt', () => {
  it('returns deterministic system and user strings with required sections', () => {
    const reader = makeReaderKnowledge();
    const previousScenes = [makeScene('s1', 1), makeScene('s2', 2)];
    const newPosition = 3;
    const sceneText = 'Alice looks at Bob and wonders what he knows.';
    const { system, user } = buildOpenAIPrompt({
      readerContext: reader,
      previousScenes,
      newPosition,
      sceneText,
      genreStyle: 'contemporary',
    });

    // System checks: markdown headers and Few-shot section with explicit JSON-only instruction
    expect(system).toContain('## Role');
    expect(system).toContain('## Task');
    expect(system).toContain('## Few-shot');
    expect(system).toContain('## Output Format');
    expect(system).toContain('Return ONLY valid JSON');

    // User checks: contains key fields
    expect(user).toContain('readerContext: ');
    expect(user).toContain('previousScenes: ');
    expect(user).toContain('newPosition: ');
    expect(user).toContain('sceneText: ');
  });
});

describe('OpenAI Prompts - JSON Schema', () => {
  it('exports a JSON Schema with required top-level and nested keys', () => {
    const schema = getOpenAIResponseJsonSchema();
    // Top-level
    expect(schema).toBeTruthy();
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeTruthy();
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['issues', 'summary']));

    // Nested issue keys
    const issueItem = (schema.properties.issues as any).items;
    expect(issueItem).toBeTruthy();
    expect(issueItem.properties).toBeTruthy();
    expect(Object.keys(issueItem.properties)).toEqual(
      expect.arrayContaining(['type', 'severity', 'span', 'explanation', 'evidence', 'suggested_fix', 'confidence'])
    );
  });

  it('provides response_format for OpenAI structured outputs with correct name and schema shape', () => {
    const rf = getOpenAIResponseFormat();
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema).toBeTruthy();
    expect(rf.json_schema.name).toBe('continuity_analysis');

    const schema = rf.json_schema.schema as Record<string, any>;
    expect(schema).toBeTruthy();
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeTruthy();
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['issues', 'summary']));
    const issueProps = (schema.properties.issues as any)?.items?.properties ?? {};
    expect(Object.keys(issueProps)).toEqual(expect.arrayContaining(['type', 'severity', 'span']));
  });
});