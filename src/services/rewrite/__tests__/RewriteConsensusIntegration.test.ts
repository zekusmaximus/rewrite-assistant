import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../shared/types';
import SceneRewriter from '../SceneRewriter';
import { ValidationPipeline } from '../../ai/validation/ValidationPipeline';
import AIServiceManager from '../../ai/AIServiceManager';

type AnalyzeReq = Parameters<AIServiceManager['analyzeContinuity']>[0];

function buildScene(overrides?: Partial<Scene>): Scene {
  const base: Scene = {
    id: 's-rewrite',
    text: 'Opening text. The incident will be clarified.',
    wordCount: 8,
    position: 5,
    originalPosition: 2,
    characters: ['Alice'],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: true,
    rewriteStatus: 'pending',
  };
  return { ...base, ...(overrides ?? {}) } as Scene;
}

function buildIssues(n = 1): ContinuityIssue[] {
  return Array.from({ length: n }).map((_, i) => ({
    type: (i % 2 === 0 ? 'plot' : 'character') as ContinuityIssue['type'],
    severity: i === 0 ? 'must-fix' : 'should-fix',
    description: `issue-${i}`,
    textSpan: [0, 5],
  }));
}

function buildReaderCtx(): ReaderKnowledge {
  return {
    knownCharacters: new Set(['Alice']),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };
}

function buildPrevScenes(n = 2): Scene[] {
  return Array.from({ length: n }).map((_, i) => ({
    id: `prev-${i}`,
    text: `Previous scene ${i} content.`,
    wordCount: 3,
    position: i,
    originalPosition: i,
    characters: ['Alice'],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: false,
    rewriteStatus: 'pending',
  })) as Scene[];
}

function makeManagerStub(recorded: AnalyzeReq[], returnsText = (id: string) => `rewrite-from-${id}`) {
  const stub: Pick<AIServiceManager, 'analyzeContinuity'> = {
    analyzeContinuity: vi.fn(async (req: AnalyzeReq) => {
      recorded.push(req);
      const text =
        (req as any)?.customPrompt
          ? returnsText(String((req as any).__modelId ?? 'primary'))
          : returnsText('noprompt');
      // Simulate provider response that SceneRewriter.parseRewriteResponse tolerates
      return {
        issues: [],
        text, // parseRewriteResponse reads from .text
        metadata: {
          modelUsed: (req as any).__modelId ?? 'mock',
          provider: 'openai',
          costEstimate: 0,
          durationMs: 1,
          confidence: 0.65,
          cached: false,
        },
      } as any;
    }) as any,
  };
  return stub as AIServiceManager;
}

describe('Rewrite consensus adapter integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('single-model path when not critical', async () => {
    const calls: AnalyzeReq[] = [];
    const manager = makeManagerStub(calls);
    const rewriter = new SceneRewriter(manager as any);

    const scene = buildScene({ position: 9 } as any); // no critical flag
    const res = await rewriter.rewriteScene({
      scene,
      issuesFound: buildIssues(1),
      readerContext: buildReaderCtx(),
      previousScenes: buildPrevScenes(1),
      preserveElements: [],
    });

    expect(res.success).toBe(true);
    expect(typeof res.rewrittenText).toBe('string');
    expect(calls.length).toBe(1);
    const req = calls[0] as any;
    // Enriched fields presence
    expect(req.taskType).toBe('continuity_rewrite');
    expect(typeof req.sceneText).toBe('string');
    expect(typeof req.newPosition).toBe('number');
    expect(req.readerContext?.knownCharacters instanceof Set).toBe(true);
    expect(Array.isArray(req.previousScenes)).toBe(true);
  });

  it('consensus path when critical: executes two runs and reconciles', async () => {
    const calls: AnalyzeReq[] = [];
    const manager = makeManagerStub(calls, (id) => `R-${id}`);
    const rewriter = new SceneRewriter(manager as any);

    const scene = buildScene({ position: 3 } as any);
    (scene as any).critical = true;

    const spyRecon = vi.spyOn(ValidationPipeline, 'reconcile');

    const res = await rewriter.rewriteScene({
      scene,
      issuesFound: buildIssues(2), // multiple issues implies complexity as well
      readerContext: buildReaderCtx(),
      previousScenes: buildPrevScenes(2),
      preserveElements: ['keep this sentence intact'],
    });

    expect(res.success).toBe(true);
    // Two attempts from consensus
    expect(calls.length).toBe(2);
    const ids = new Set((calls as any[]).map((r: any) => r.__modelId).filter(Boolean));
    expect(ids.size).toBeGreaterThanOrEqual(2);

    // Enriched AnalysisRequest fields present on each run
    for (const r of calls as any[]) {
      expect(r.taskType).toBe('continuity_rewrite');
      expect(typeof r.sceneText).toBe('string');
      expect(typeof r.newPosition).toBe('number');
    }

    expect(spyRecon).toHaveBeenCalledTimes(1);
  });
});