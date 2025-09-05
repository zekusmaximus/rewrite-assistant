import { describe, it, expect, vi } from 'vitest';
import SceneRewriter from '../SceneRewriter';
import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../shared/types';

function makeRequest(overrides: Partial<{
  scene: Scene;
  issues: ContinuityIssue[];
  reader: ReaderKnowledge;
}> = {}) {
  const scene: Scene = overrides.scene || ({
    id: 's1',
    text: 'Original scene text.',
    wordCount: 3,
    position: 0,
    originalPosition: 0,
    characters: [],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: false,
    rewriteStatus: 'pending'
  } as any);

  const issues: ContinuityIssue[] = overrides.issues || ([
    { type: 'pronoun', severity: 'should-fix', description: 'Pronoun ambiguity', textSpan: [0, 7] } as any
  ]);

  const reader: ReaderKnowledge = overrides.reader || {
    knownCharacters: new Set<string>(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: []
  };

  return { scene, issues, reader };
}

describe('SceneRewriter retry/backoff', () => {
  it('retries on failure and succeeds on subsequent attempt', async () => {
    const mockAI = {
      analyzeContinuity: vi
        .fn()
        // First attempt: simulate transport error path (rewriteScene catches and returns failure)
        .mockRejectedValueOnce(new Error('network failure'))
        // Second attempt: success
        .mockResolvedValueOnce({ rewrittenText: 'Rewritten successfully', modelUsed: 'mock' })
    };

    const rewriter = new SceneRewriter(mockAI as any);
    // Remove actual delays for test speed
    (rewriter as any).delay = vi.fn().mockResolvedValue(undefined);
    (rewriter as any).maxRetries = 3;

    const { scene, issues, reader } = makeRequest();
    const result = await (rewriter as any).rewriteSceneWithRetry({
      scene,
      issuesFound: issues,
      readerContext: reader,
      previousScenes: [],
      preserveElements: []
    });

    expect(mockAI.analyzeContinuity).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.rewrittenText).toBe('Rewritten successfully');
  });

  it('fails fast on non-retryable errors (invalid api key)', async () => {
    const mockAI = {
      analyzeContinuity: vi.fn().mockRejectedValue(new Error('Invalid API key'))
    };

    const rewriter = new SceneRewriter(mockAI as any);
    (rewriter as any).delay = vi.fn().mockResolvedValue(undefined);
    (rewriter as any).maxRetries = 5;

    const { scene, issues, reader } = makeRequest();
    const result = await (rewriter as any).rewriteSceneWithRetry({
      scene,
      issuesFound: issues,
      readerContext: reader,
      previousScenes: [],
      preserveElements: []
    });

    // Should only attempt once
    expect(mockAI.analyzeContinuity).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed after/i);
    expect(result.error).toMatch(/invalid api key/i);
  });
});