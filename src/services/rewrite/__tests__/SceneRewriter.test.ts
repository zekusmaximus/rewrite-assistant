import { describe, it, expect, vi } from 'vitest';
import SceneRewriter from '../../rewrite/SceneRewriter';
import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../shared/types';

describe('SceneRewriter', () => {
  const baseScene: Scene = {
    id: 's1',
    text: 'Alice walks into the room. She sees Bob.',
    // optional fields tolerated; leave undefined
  } as any;

  const issues: ContinuityIssue[] = [
    { id: 'i1', type: 'pronoun', severity: 'should-fix', description: 'Ambiguous "She" pronoun.' } as any,
  ];

  const readerContext: ReaderKnowledge = {
    knownCharacters: new Set(['Alice', 'Bob']),
    establishedTimeline: [{ label: 'Morning' }],
    revealedPlotPoints: ['Alice met Bob previously'],
    establishedSettings: [{ name: 'Apartment' }],
  };

  it('generates exactly one rewrite and returns structured result', async () => {
    const mockAI = {
      analyzeContinuity: vi.fn().mockResolvedValue({
        rewrittenText: 'Alice walks into the room. Alice sees Bob.',
        modelUsed: 'mock-model',
      }),
    };

    const rewriter = new SceneRewriter(mockAI as any);

    const result = await rewriter.rewriteScene({
      scene: baseScene,
      issuesFound: issues,
      readerContext,
      previousScenes: [],
      preserveElements: [],
    });

    expect(mockAI.analyzeContinuity).toHaveBeenCalledTimes(1);
    const callArg = mockAI.analyzeContinuity.mock.calls[0][0];
    expect(callArg).toMatchObject({
      scene: baseScene,
      previousScenes: [],
      readerContext,
      customPrompt: expect.any(String),
      isRewriteRequest: true,
      preserveElements: [],
    });

    expect(result.success).toBe(true);
    expect(typeof result.rewrittenText).toBe('string');
    expect(result.rewrittenText).toContain('Alice sees Bob'); // pronoun clarified
    expect(Array.isArray(result.issuesAddressed)).toBe(true);
    expect(typeof result.changesExplanation).toBe('string');
    expect(Array.isArray(result.diffData)).toBe(true);
    expect(result.modelUsed).toBe('mock-model');
  });

  it('does not mutate original scene text (original text is never lost)', async () => {
    const mockAI = {
      analyzeContinuity: vi.fn().mockResolvedValue({
        rewrittenText: 'Alice walks into the room. Alice sees Bob.',
      }),
    };
    const sceneCopy = { ...baseScene, text: 'Alice walks into the room. She sees Bob.' };

    const rewriter = new SceneRewriter(mockAI as any);
    const result = await rewriter.rewriteScene({
      scene: sceneCopy,
      issuesFound: issues,
      readerContext,
      previousScenes: [],
      preserveElements: [],
    });

    expect(sceneCopy.text).toBe('Alice walks into the room. She sees Bob.');
    expect(result.success).toBe(true);
    expect(result.rewrittenText).toBe('Alice walks into the room. Alice sees Bob.');
  });

  it('fails gracefully when no issues provided', async () => {
    const mockAI = {
      analyzeContinuity: vi.fn(),
    };
    const rewriter = new SceneRewriter(mockAI as any);

    const result = await rewriter.rewriteScene({
      scene: baseScene,
      issuesFound: [],
      readerContext,
      previousScenes: [],
      preserveElements: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid request');
  });

  it('routes analysis type based on issues complexity', async () => {
    const mockAI = {
      analyzeContinuity: vi.fn().mockResolvedValue({ rewrittenText: baseScene.text }),
    };
    const rewriter = new SceneRewriter(mockAI as any);

    // complex path: must-fix + character/plot
    await rewriter.rewriteScene({
      scene: baseScene,
      issuesFound: [
        { id: 'i2', type: 'plot', severity: 'must-fix', description: 'Missing plot context' } as any,
      ],
      readerContext,
      previousScenes: [],
      preserveElements: [],
    });
    let arg = mockAI.analyzeContinuity.mock.calls.at(-1)[0];
    expect(arg.analysisType).toBe('complex');

    // consistency path: character/plot without must-fix
    await rewriter.rewriteScene({
      scene: baseScene,
      issuesFound: [
        { id: 'i3', type: 'character', severity: 'should-fix', description: 'Character context' } as any,
      ],
      readerContext,
      previousScenes: [],
      preserveElements: [],
    });
    arg = mockAI.analyzeContinuity.mock.calls.at(-1)[0];
    expect(arg.analysisType).toBe('consistency');

    // simple path: pronoun only
    await rewriter.rewriteScene({
      scene: baseScene,
      issuesFound: [
        { id: 'i4', type: 'pronoun', severity: 'should-fix', description: 'Pronoun clarity' } as any,
      ],
      readerContext,
      previousScenes: [],
      preserveElements: [],
    });
    arg = mockAI.analyzeContinuity.mock.calls.at(-1)[0];
    expect(arg.analysisType).toBe('simple');
  });
});