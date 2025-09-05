import { describe, it, beforeEach, expect, vi } from 'vitest';
import useRewriteStore from '../stores/rewriteStore';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import type { Manuscript, Scene, ContinuityIssue, ReaderKnowledge } from '../../../../shared/types';
import type { BatchRewriteProgress, BatchRewriteOptions } from '../../../../services/rewrite/RewriteOrchestrator';
import type { RewriteResult } from '../../../../services/rewrite/SceneRewriter';

function buildIssue(): ContinuityIssue {
  return {
    type: 'pronoun',
    severity: 'must-fix',
    description: 'Ambiguous pronoun reference',
    textSpan: [0, 5],
    suggestedFix: 'Clarify subject'
  };
}

function buildScene(id: string, position: number): Scene {
  const readerContext: ReaderKnowledge = {
    knownCharacters: new Set(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: []
  };

  return {
    id,
    text: `Original ${id}`,
    wordCount: 2,
    position,
    originalPosition: position,
    characters: [],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: true,
    rewriteStatus: 'pending',
    continuityAnalysis: {
      issues: [buildIssue()],
      timestamp: Date.now(),
      modelUsed: 'test',
      confidence: 0.9,
      readerContext
    }
  };
}

function buildManuscript(ids: string[]): Manuscript {
  const scenes = ids.map((id, idx) => buildScene(id, idx));
  return {
    id: 'm-batch',
    title: 'Batch Manuscript',
    scenes,
    originalOrder: scenes.map(s => s.id),
    currentOrder: scenes.map(s => s.id)
  };
}

class OrchestratorFake {
  cancelled = false;

  cancelBatch() {
    this.cancelled = true;
  }

  async rewriteMovedScenes(
    manuscript: Pick<Manuscript, 'scenes' | 'currentOrder'>,
    options: BatchRewriteOptions = {}
  ): Promise<BatchRewriteProgress> {
    const sceneIds = manuscript.currentOrder;

    const progress: BatchRewriteProgress = {
      totalScenes: sceneIds.length,
      completedScenes: 0,
      phase: 'preparing',
      message: 'Preparing batch rewrite...',
      results: new Map(),
      errors: new Map()
    };

    options.progressCallback?.(progress);

    // Simulate sequential processing
    for (const id of sceneIds) {
      if (this.cancelled) {
        progress.phase = 'error';
        progress.message = 'Batch rewrite cancelled';
        break;
      }

      progress.currentSceneId = id;
      progress.currentSceneTitle = manuscript.scenes.find(s => s.id === id)?.text.split('\n')[0];
      progress.phase = 'rewriting';
      progress.message = `Rewriting scene ${progress.completedScenes + 1} of ${progress.totalScenes}`;
      options.progressCallback?.(progress);

      // Simulate result
      const result: RewriteResult = {
        success: true,
        rewrittenText: `Rewritten ${id}`,
        issuesAddressed: manuscript.scenes.find(s => s.id === id)?.continuityAnalysis?.issues ?? [],
        changesExplanation: `Fixed issues in ${id}`,
        preservedElements: [],
        diffData: [],
        modelUsed: 'fake-model'
      };
      progress.results.set(id, result);
      progress.completedScenes += 1;
      options.progressCallback?.(progress);
    }

    if (!this.cancelled) {
      progress.phase = 'complete';
      progress.message = `Successfully rewrote ${progress.results.size} scenes`;
    }

    return progress;
  }
}

describe('Rewrite Store — batch operations', () => {
  beforeEach(() => {
    // Reset manuscript
    const manuscript = buildManuscript(['s1', 's2', 's3']);
    useManuscriptStore.setState({
      manuscript,
      selectedSceneId: manuscript.scenes[0].id,
      isLoading: false,
      error: null
    });

    // Reset rewrite store state
    useRewriteStore.setState({
      isRewriting: false,
      currentRewriteSceneId: undefined,
      rewriteProgress: { stage: 'idle', message: '' },
      sceneRewrites: new Map(),
      activeEdits: new Map(),
      diffCache: new Map(),
      batchProgress: undefined,
      isBatchRewriting: false,
      batchOrchestrator: undefined,
      showHistory: new Map(),
    } as any);
  });

  it('startBatchRewrite updates progress and stores per-scene results', async () => {
    const orchestrator = new OrchestratorFake();
    // Inject orchestrator into store
    useRewriteStore.setState({ batchOrchestrator: orchestrator } as any);

    const { startBatchRewrite } = useRewriteStore.getState();

    await startBatchRewrite({ skipIfNoIssues: false });

    const state = useRewriteStore.getState();
    expect(state.isBatchRewriting).toBe(false);
    expect(state.batchProgress?.phase).toBe('complete');
    expect(state.batchProgress?.results.size).toBe(3);

    // Rewrites map should contain ONE rewrite per scene (replace behavior)
    for (const id of ['s1', 's2', 's3']) {
      expect(state.sceneRewrites.has(id)).toBe(true);
      const history = state.sceneRewrites.get(id)!;
      expect(history.length).toBe(1);
      expect(history[0].rewrittenText).toBe(`Rewritten ${id}`);
    }

    // Manuscript scenes should be marked generated with currentRewrite populated
    const manuscript = useManuscriptStore.getState().manuscript!;
    for (const id of manuscript.currentOrder) {
      const scene = manuscript.scenes.find(s => s.id === id)!;
      expect(scene.rewriteStatus).toBe('generated');
      expect(scene.currentRewrite).toBe(`Rewritten ${id}`);
    }
  });

  it('cancelBatchRewrite calls orchestrator.cancelBatch and marks state cancelled', async () => {
    const orchestrator = new OrchestratorFake();
    useRewriteStore.setState({ batchOrchestrator: orchestrator } as any);

    const { startBatchRewrite, cancelBatchRewrite } = useRewriteStore.getState();

    // Start but immediately cancel; our fake will pick up the cancelled flag
    const startPromise = startBatchRewrite({ skipIfNoIssues: false });
    cancelBatchRewrite();
    await startPromise;

    const state = useRewriteStore.getState();
    expect(orchestrator.cancelled).toBe(true);
    expect(state.isBatchRewriting).toBe(false);
    expect(state.batchProgress?.phase).toBe('error');
    expect(state.batchProgress?.message).toContain('cancelled');
  });
});