import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Manuscript, Scene, ContinuityIssue, ReaderKnowledge } from '../../../shared/types';

// Mock SceneRewriter to avoid real AI calls and to capture inputs
const callOrder: string[] = [];
const receivedContexts: Array<{ id: string; knownChars: string[] }> = [];
const deferredResolvers: Record<string, () => void> = {};
let throwOn: Set<string> = new Set();

vi.mock('../SceneRewriter', () => {
  return {
    default: class SceneRewriterMock {
      async rewriteScene(req: any) {
        const id = req.scene.id as string;
        callOrder.push(id);
        receivedContexts.push({
          id,
          knownChars: Array.from(req.readerContext?.knownCharacters ?? []),
        });

        if (throwOn.has(id)) {
          throw new Error(`Simulated failure for ${id}`);
        }

        // Allow tests to control resolution for cancellation behavior
        if (deferredResolvers[id]) {
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            deferredResolvers[id] = done;
          });
        }

        return {
          success: true,
          rewrittenText: `rewritten:${id}`,
          issuesAddressed: req.issuesFound ?? [],
          changesExplanation: `changes for ${id}`,
          preservedElements: [],
          diffData: [],
          modelUsed: 'mock-model',
        };
      }
    }
  };
});

import RewriteOrchestrator from '../RewriteOrchestrator';

function buildIssue(): ContinuityIssue {
  return {
    type: 'pronoun',
    severity: 'must-fix',
    description: 'Ambiguous pronoun',
    textSpan: [0, 5],
    suggestedFix: 'Clarify subject',
  };
}

function buildScene(id: string, position: number, chars: string[] = []): Scene {
  const rk: ReaderKnowledge = {
    knownCharacters: new Set(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: []
  };

  return {
    id,
    text: `Text of ${id}`,
    wordCount: 3,
    position,
    originalPosition: position,
    characters: chars,
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: true,
    rewriteStatus: 'pending',
    continuityAnalysis: {
      issues: [buildIssue()],
      timestamp: Date.now(),
      modelUsed: 'test',
      confidence: 0.9,
      readerContext: rk
    }
  };
}

function buildManuscript(scenes: Scene[], currentOrder: string[]): Manuscript {
  return {
    id: 'm1',
    title: 'Test Manuscript',
    scenes,
    originalOrder: scenes.map(s => s.id),
    currentOrder
  };
}

beforeEach(() => {
  callOrder.length = 0;
  receivedContexts.length = 0;
  Object.keys(deferredResolvers).forEach(k => delete deferredResolvers[k]);
  throwOn = new Set();
});

describe('RewriteOrchestrator.rewriteMovedScenes()', () => {
  it('processes scenes in dependency (current narrative) order', async () => {
    const sA = buildScene('A', 1);
    const sB = buildScene('B', 0);
    const sC = buildScene('C', 2);

    // Narrative order is B, A, C
    const manuscript = buildManuscript([sA, sB, sC], ['B', 'A', 'C']);

    const orchestrator = new RewriteOrchestrator();
    const progress = await orchestrator.rewriteMovedScenes(manuscript, { skipIfNoIssues: false });

    expect(progress.totalScenes).toBe(3);
    expect(callOrder).toEqual(['B', 'A', 'C']);
    expect(progress.results.size).toBe(3);
    expect(progress.phase === 'complete' || progress.phase === 'error').toBe(true);
  });

  it('builds reader context progressively from previous scenes', async () => {
    const s1 = buildScene('S1', 0, ['Alice']);
    const s2 = buildScene('S2', 1, ['Bob']);
    const s3 = buildScene('S3', 2, ['Carol']);

    const manuscript = buildManuscript([s1, s2, s3], ['S1', 'S2', 'S3']);

    const orchestrator = new RewriteOrchestrator();
    await orchestrator.rewriteMovedScenes(manuscript, { skipIfNoIssues: false });

    // Find the record for S2 and S3 calls
    const recS2 = receivedContexts.find(r => r.id === 'S2');
    const recS3 = receivedContexts.find(r => r.id === 'S3');

    expect(recS2).toBeTruthy();
    expect(recS2?.knownChars).toContain('Alice');

    expect(recS3).toBeTruthy();
    // By S3, both Alice and Bob should be in known context
    expect(recS3?.knownChars).toEqual(expect.arrayContaining(['Alice', 'Bob']));
  });

  it('continues batch when a single scene rewrite fails', async () => {
    const s1 = buildScene('S1', 0);
    const s2 = buildScene('S2', 1);
    const s3 = buildScene('S3', 2);

    const manuscript = buildManuscript([s1, s2, s3], ['S1', 'S2', 'S3']);

    // Make S2 fail
    throwOn.add('S2');

    const orchestrator = new RewriteOrchestrator();
    const progress = await orchestrator.rewriteMovedScenes(manuscript, { skipIfNoIssues: false });

    expect(progress.errors.size).toBe(1);
    expect(progress.errors.get('S2')).toBeTruthy();
    expect(progress.results.size).toBe(2); // S1 and S3 succeeded
  });

  it('cancellation stops further processing after current scene', async () => {
    const s1 = buildScene('S1', 0);
    const s2 = buildScene('S2', 1);
    const s3 = buildScene('S3', 2);

    const manuscript = buildManuscript([s1, s2, s3], ['S1', 'S2', 'S3']);

    // Make first call deferred so we can cancel while it's running
    deferredResolvers['S1'] = () => {};

    const orchestrator = new RewriteOrchestrator();
    const runPromise = orchestrator.rewriteMovedScenes(manuscript, { skipIfNoIssues: false });

    // Cancel while first scene is in-flight
    orchestrator.cancelBatch();

    // Resolve the first scene now
    // Call the stored resolver for S1
    // Note: our mock stores a new resolver when invoked; we need to trigger it.
    // Because we replace it inside the promise constructor, access it via key:
    const resolverKeys = Object.keys(deferredResolvers);
    if (resolverKeys.includes('S1')) {
      // Invoke resolver to allow first scene to complete
      deferredResolvers['S1']();
      delete deferredResolvers['S1'];
    }

    const progress = await runPromise;

    // Should have processed only S1 due to cancellation before starting S2
    expect(callOrder).toEqual(['S1']);
    // Phase may be 'error' due to our finalize rule, but primary check is count
    expect(progress.completedScenes).toBeGreaterThanOrEqual(1);
  });
});