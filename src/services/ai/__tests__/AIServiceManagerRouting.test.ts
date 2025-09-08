import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import AIServiceManager from '../../ai/AIServiceManager';
import type { AnalysisRequest, AnalysisResponse, ProviderName } from '../../ai/types';

// Minimal stub tracker with controllable per-model scores by taskType
class StubTracker {
  private map = new Map<string, number>(); // key = modelId::taskType
  private defaultBase = 0.7;

  private key(modelId: string, taskType: string) {
    return `${modelId}::${taskType}`;
  }

  public setScore(modelId: string, taskType: string, score: number) {
    this.map.set(this.key(modelId, taskType), Math.max(0, Math.min(1, score)));
  }

  // No-op for tests
  public recordResult() {}

  public getMetrics() {
    return {
      avgConfidence: 0.7,
      successRate: 0.7,
      avgLatencyMs: 1000,
      samples: 0,
      lastUpdatedAt: null as number | null,
    };
  }

  // Emulate penalty behavior similar to real tracker: multiply base by (1 - 0.3 * costWeight)
  public score(modelId: string, taskType: string, opts?: { costWeight?: number; latencyWeight?: number; accuracyWeight?: number }) {
    const base = this.map.get(this.key(modelId, taskType)) ?? this.defaultBase;
    const costWeight = clamp01(opts?.costWeight ?? 0);
    const penalty = 1 - 0.3 * costWeight;
    return clamp01(base * penalty);
  }
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function makeSimpleRequest(): AnalysisRequest {
  return {
    analysisType: 'simple',
    scene: {
      id: 's1',
      text: 'A short scene.',
      wordCount: 3,
      position: 1,
      originalPosition: 1,
      characters: ['Alice'],
      timeMarkers: [],
      locationMarkers: [],
      hasBeenMoved: false,
      rewriteStatus: 'pending',
    } as any,
    previousScenes: [],
    readerContext: {
      knownCharacters: new Set(['Alice']),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: [],
    },
  };
}

function makeResponse(model: string, provider: ProviderName, confidence: number, durationMs = 100): AnalysisResponse {
  return {
    issues: [],
    metadata: {
      modelUsed: model,
      provider,
      costEstimate: 0,
      durationMs,
      confidence,
      cached: false,
    },
  };
}

describe('AIServiceManager adaptive routing', () => {
  beforeEach(() => {
    // fresh tracker per test
    const tracker = new StubTracker();
    (AIServiceManager as any).__setTestTracker(tracker);
    // Stabilize epsilon-greedy selection to keep tests deterministic
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    (AIServiceManager as any).__setTestTracker(null);
    vi.restoreAllMocks();
  });

  it('selects the fast model (Claude 3.5 Haiku) for simple requests with neutral metrics', async () => {
    const mgr = new AIServiceManager();
    // Configure all providers (fake keys, no network thanks to stubs below)
    mgr.configure({
      claude: { apiKey: 'x' },
      openai: { apiKey: 'y' },
      gemini: { apiKey: 'z' },
    });

    const providers = (mgr as any).providers as Map<string, any>;
    // Stub analyze for all configured models
    providers.forEach((prov, id) => {
      if (id === 'claude-3-5-haiku') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('claude-3-5-haiku', 'anthropic', 0.85, 120));
      } else if (id === 'claude-opus-4-1') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('claude-opus-4-1', 'anthropic', 0.9, 300));
      } else if (id === 'claude-sonnet-4') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('claude-sonnet-4', 'anthropic', 0.82, 180));
      } else if (id === 'gpt-5') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('gpt-5', 'openai', 0.8, 200));
      } else if (id === 'gemini-2-5-pro') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('gemini-2-5-pro', 'google', 0.8, 220));
      }
    });

    const req = makeSimpleRequest();
    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('claude-3-5-haiku');
  });

  it('escalates to strong tier when confidence below threshold', async () => {
    const mgr = new AIServiceManager();
    mgr.configure({
      claude: { apiKey: 'x' },
      openai: { apiKey: 'y' },
      gemini: { apiKey: 'z' },
    });

    const providers = (mgr as any).providers as Map<string, any>;
    // Force base fast model to low confidence to trigger escalation, strong to high confidence
    providers.forEach((prov, id) => {
      if (id === 'claude-3-5-haiku') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('claude-3-5-haiku', 'anthropic', 0.5, 120)); // below 0.65 simple threshold
      } else if (id === 'claude-opus-4-1') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('claude-opus-4-1', 'anthropic', 0.9, 300));
      } else if (!prov.analyze) {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse(id, 'openai', 0.8, 200));
      } else {
        // leave other stubs as-is or default
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse(id, 'openai', 0.8, 200));
      }
    });

    const req = makeSimpleRequest(); // simple task triggers base fast; low confidence should escalate
    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
  });

  it('prefers balanced GPT when tracker shows higher accuracy for the taskType despite higher cost', async () => {
    // Install a tracker that boosts GPT specifically for 'simple'
    const boostedTracker = new StubTracker();
    boostedTracker.setScore('gpt-5', 'simple', 0.95);
    boostedTracker.setScore('claude-3-5-haiku', 'simple', 0.8);
    (AIServiceManager as any).__setTestTracker(boostedTracker);

    const mgr = new AIServiceManager();
    mgr.configure({
      claude: { apiKey: 'x' },
      openai: { apiKey: 'y' },
      gemini: { apiKey: 'z' },
    });

    const providers = (mgr as any).providers as Map<string, any>;
    providers.forEach((prov, id) => {
      if (id === 'gpt-5') {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('gpt-5', 'openai', 0.88, 190));
      } else if (id === 'claude-3-5-haiku') {
        // Good but slightly lower confidence, so selection should favor GPT given boosted tracker score
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse('claude-3-5-haiku', 'anthropic', 0.82, 130));
      } else {
        prov.analyze = vi.fn(async (req: AnalysisRequest) => makeResponse(id, 'openai', 0.8, 200));
      }
    });

    const req = makeSimpleRequest();
    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('gpt-5');
  });
});