import { describe, it, beforeEach, expect, vi } from 'vitest';
import useRewriteStore from '../../rewrite/stores/rewriteStore';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import type { Manuscript, Scene, ContinuityIssue, ReaderKnowledge } from '../../../../shared/types';

// Helper: build a baseline scene with continuity analysis issues
function buildScene(overrides: Partial<Scene> = {}): Scene {
  const issues: ContinuityIssue[] = [
    {
      type: 'pronoun',
      severity: 'must-fix',
      description: 'Ambiguous pronoun reference',
      textSpan: [0, 10],
      suggestedFix: 'Clarify the subject',
    },
  ];

  const readerContext: ReaderKnowledge = {
    knownCharacters: new Set<string>(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };

  const base: Scene = {
    id: 's1',
    text: 'Original scene text.',
    wordCount: 3,
    position: 0,
    originalPosition: 0,
    characters: [],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: true,
    rewriteStatus: 'pending',
    continuityAnalysis: {
      issues,
      timestamp: Date.now(),
      modelUsed: 'test-model',
      confidence: 0.8,
      readerContext,
    },
  };

  return { ...base, ...overrides };
}

function buildManuscript(scene: Scene): Manuscript {
  return {
    id: 'm1',
    title: 'Test Manuscript',
    scenes: [scene],
    originalOrder: [scene.id],
    currentOrder: [scene.id],
  };
}

// Reset Zustand stores between tests by clearing only state fields (not methods)
function resetRewriteStoreState() {
  useRewriteStore.setState({
    isRewriting: false,
    currentRewriteSceneId: undefined,
    rewriteProgress: { stage: 'idle', message: '' },
    sceneRewrites: new Map(),
    activeEdits: new Map(),
    diffCache: new Map(),
  } as any);
}

describe('Rewrite Store - Phase 3.2 workflow', () => {
  beforeEach(() => {
    resetRewriteStoreState();

    // Fresh manuscript with one scene
    const scene = buildScene();
    const manuscript = buildManuscript(scene);
    useManuscriptStore.setState({
      manuscript,
      selectedSceneId: scene.id,
      isLoading: false,
      error: null,
    });

    // Mock IPC invoke: window.electron.ipcRenderer.invoke
    (globalThis as any).window = (globalThis as any).window ?? {};
    (window as any).electron = (window as any).electron ?? {};
    (window as any).electron.ipcRenderer = {
      invoke: vi.fn(async (_channel: string, _payload: any) => {
        return {
          success: true,
          rewrittenText: 'Rewritten scene text.',
          issuesAddressed: manuscript.scenes[0].continuityAnalysis?.issues ?? [],
          changesExplanation: 'Fixed pronoun ambiguity.',
          modelUsed: 'unit-test-model',
        };
      }),
    };
  });

  it('generateRewrite creates a single latest version and updates manuscript flags', async () => {
    const sceneId = 's1';
    const { generateRewrite, getLatestRewrite, getDiff } = useRewriteStore.getState();

    await generateRewrite(sceneId);

    const latest = getLatestRewrite(sceneId);
    expect(latest).toBeTruthy();
    expect(latest?.sceneId).toBe(sceneId);
    expect(latest?.rewrittenText).toBe('Rewritten scene text.');
    expect(latest?.userEdited).toBe(false);
    expect(latest?.appliedToManuscript).toBe(false);

    const diff = getDiff(sceneId);
    expect(diff).toBeTruthy();
    expect(Array.isArray(diff)).toBe(true);

    const manuscript = useManuscriptStore.getState().manuscript!;
    const scene = manuscript.scenes.find(s => s.id === sceneId)!;
    expect(scene.rewriteStatus).toBe('generated');
    expect(scene.currentRewrite).toBe('Rewritten scene text.');
    // Ensure original is preserved until apply
    expect(scene.text).toBe('Original scene text.');
  });

  it('edit tracking works: updateEditedText + saveEdit creates a userEdited version and updates currentRewrite', async () => {
    const sceneId = 's1';
    const store = useRewriteStore.getState();

    await store.generateRewrite(sceneId);

    store.updateEditedText(sceneId, 'User edited rewrite.');
    store.saveEdit(sceneId);

    const latest = store.getLatestRewrite(sceneId);
    expect(latest?.userEdited).toBe(true);
    expect(latest?.rewrittenText).toBe('User edited rewrite.');

    const scene = useManuscriptStore.getState().manuscript!.scenes.find(s => s.id === sceneId)!;
    expect(scene.currentRewrite).toBe('User edited rewrite.');
    // Original still preserved
    expect(scene.text).toBe('Original scene text.');
  });

  it('applyRewrite applies final text to manuscript and marks approved', async () => {
    const sceneId = 's1';
    const store = useRewriteStore.getState();

    await store.generateRewrite(sceneId);
    // Simulate user edit before applying
    store.updateEditedText(sceneId, 'User edited rewrite.');
    store.saveEdit(sceneId);

    store.applyRewrite(sceneId);

    const manuscript = useManuscriptStore.getState().manuscript!;
    const scene = manuscript.scenes.find(s => s.id === sceneId)!;
    expect(scene.text).toBe('User edited rewrite.');
    expect(scene.rewriteStatus).toBe('approved');
    expect(scene.currentRewrite).toBeUndefined();

    const latest = store.getLatestRewrite(sceneId);
    expect(latest?.appliedToManuscript).toBe(true);
  });

  it('rejectRewrite sets status to rejected and preserves original text', async () => {
    const sceneId = 's1';
    const store = useRewriteStore.getState();

    await store.generateRewrite(sceneId);
    store.rejectRewrite(sceneId);

    const manuscript = useManuscriptStore.getState().manuscript!;
    const scene = manuscript.scenes.find(s => s.id === sceneId)!;
    expect(scene.rewriteStatus).toBe('rejected');
    expect(scene.text).toBe('Original scene text.');
    expect(scene.currentRewrite).toBeUndefined();
  });
});