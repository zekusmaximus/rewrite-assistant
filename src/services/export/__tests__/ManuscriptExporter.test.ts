import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import ManuscriptExporter from '../ManuscriptExporter';
import type { Manuscript, Scene, RewriteVersion, ContinuityIssue } from '../../../shared/types';

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function makeScenes(): Scene[] {
  const s1Text = 'Scene One. Alice enters. Morning light fills the room.';
  const s2Text = 'Scene Two. She greets Bob. They talk about yesterday.';
  const s1: Scene = {
    id: 's1',
    text: s1Text,
    wordCount: countWords(s1Text),
    position: 0,
    originalPosition: 0,
    characters: ['Alice'],
    timeMarkers: ['Morning'],
    locationMarkers: ['Apartment'],
    hasBeenMoved: false,
    rewriteStatus: 'pending'
  };
  const s2: Scene = {
    id: 's2',
    text: s2Text,
    wordCount: countWords(s2Text),
    position: 1,
    originalPosition: 1,
    characters: ['Alice', 'Bob'],
    timeMarkers: ['Yesterday'],
    locationMarkers: ['Apartment'],
    hasBeenMoved: false,
    rewriteStatus: 'pending'
  };
  return [s1, s2];
}

function makeManuscript(): Manuscript {
  const scenes = makeScenes();
  return {
    id: 'm1',
    title: 'Test Manuscript',
    scenes,
    originalOrder: scenes.map(s => s.id),
    currentOrder: scenes.map(s => s.id),
    filePath: undefined
  };
}

function makeRewrites(): Map<string, RewriteVersion[]> {
  const issue: ContinuityIssue = {
    type: 'pronoun',
    severity: 'should-fix',
    description: 'Ambiguous pronoun "She".',
    textSpan: [0, 3],
    suggestedFix: 'Clarify the subject.'
  } as any;

  const rewritten = 'Scene Two. Alice greets Bob. They talk about yesterday.';
  const v: RewriteVersion = {
    id: 'r1',
    sceneId: 's2',
    timestamp: Date.now(),
    rewrittenText: rewritten,
    issuesAddressed: [issue],
    changesExplanation: 'Clarified pronoun.',
    modelUsed: 'claude-3-opus',
    userEdited: false,
    appliedToManuscript: false
  };
  return new Map<string, RewriteVersion[]>([['s2', [v]]]);
}

async function makeTmpDir(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'exporter-test-'));
  return base;
}

describe('ManuscriptExporter', () => {
  it('exports original format with scene breaks', async () => {
    const exporter = new ManuscriptExporter();
    const manuscript = makeManuscript();
    const rewrites = new Map<string, RewriteVersion[]>();
    const dir = await makeTmpDir();

    const result = await exporter.exportManuscript(manuscript, rewrites, {
      format: 'original',
      includeMetadata: false,
      includeChangeLog: false,
      changeLogDetail: 'summary',
      outputPath: dir,
      filename: 'original.txt'
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toBeTruthy();

    const content = await fs.readFile(result.filePath!, 'utf-8');
    expect(content).toContain('Scene One.');
    expect(content).toContain('Scene Two.');
    expect(content).toContain('### SCENE BREAK ###');
    expect(result.stats).toBeTruthy();
    expect(result.stats!.totalScenes).toBe(2);
  });

  it('exports rewritten format using latest rewrite when not approved', async () => {
    const exporter = new ManuscriptExporter();
    const manuscript = makeManuscript();
    const rewrites = makeRewrites();
    const dir = await makeTmpDir();

    const result = await exporter.exportManuscript(manuscript, rewrites, {
      format: 'rewritten',
      includeMetadata: false,
      includeChangeLog: false,
      changeLogDetail: 'summary',
      outputPath: dir,
      filename: 'rewritten.txt'
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(result.filePath!, 'utf-8');
    // Rewritten scene 2 must be used
    expect(content).toContain('Alice greets Bob');
    // Original scene 1 still present
    expect(content).toContain('Scene One.');
  });

  it('exports both versions with section headers', async () => {
    const exporter = new ManuscriptExporter();
    const manuscript = makeManuscript();
    const rewrites = makeRewrites();
    const dir = await makeTmpDir();

    const result = await exporter.exportManuscript(manuscript, rewrites, {
      format: 'both',
      includeMetadata: true,
      includeChangeLog: true,
      changeLogDetail: 'summary',
      outputPath: dir,
      filename: 'both.txt'
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(result.filePath!, 'utf-8');
    expect(content).toContain('MANUSCRIPT EXPORT');
    expect(content).toContain('ORIGINAL VERSION');
    expect(content).toContain('REWRITTEN VERSION');
  });

  it('exports change log only and attributes model', async () => {
    const exporter = new ManuscriptExporter();
    const manuscript = makeManuscript();
    const rewrites = makeRewrites();
    const dir = await makeTmpDir();

    const result = await exporter.exportManuscript(manuscript, rewrites, {
      format: 'changelog',
      includeMetadata: false,
      includeChangeLog: false,
      changeLogDetail: 'detailed',
      outputPath: dir,
      filename: 'changelog.txt'
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(result.filePath!, 'utf-8');
    expect(content).toContain('MANUSCRIPT CHANGE LOG');
    expect(content).toContain('AI Model:');
    // Document fixes: ensure issue type and description are present (no quality scores)
    expect(content).toMatch(/PRONOUN: Ambiguous pronoun/i);
  });

  it('appends change log when requested and returns stats', async () => {
    const exporter = new ManuscriptExporter();
    const manuscript = makeManuscript();
    const rewrites = makeRewrites();
    const dir = await makeTmpDir();

    const result = await exporter.exportManuscript(manuscript, rewrites, {
      format: 'rewritten',
      includeMetadata: true,
      includeChangeLog: true,
      changeLogDetail: 'summary',
      outputPath: dir,
      filename: 'with-changelog.txt'
    });

    expect(result.success).toBe(true);
    expect(result.stats).toBeTruthy();
    expect(result.stats!.totalScenes).toBe(2);
    expect(result.stats!.rewrittenScenes).toBeGreaterThanOrEqual(1);

    const content = await fs.readFile(result.filePath!, 'utf-8');
    expect(content).toContain('MANUSCRIPT EXPORT');
    expect(content).toContain('MANUSCRIPT CHANGE LOG');
  });
});