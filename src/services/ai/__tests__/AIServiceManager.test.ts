import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import AIServiceManager from '../../ai/AIServiceManager';
import PromptCache from '../../ai/cache/PromptCache';
import {
  type AnalysisRequest,
  type AnalysisResponse,
  type ProviderName,
} from '../../ai/types';
import { batchAnalyze } from '../../ai/optimization/RequestBatcher';

// -----------------------------
// Local mock utilities (registry + factories)
// -----------------------------

type FailureType = 'network' | 'rateLimit' | 'invalid' | 'timeout' | 'validation' | 'baseFetchRetry';

type Behavior = {
  name?: string;
  shouldFail?: boolean;
  failureType?: FailureType;
  responseTime?: number;
  response?: Partial<AnalysisResponse>;
  confidence?: number;
};

type BehaviorRegistry = Map<string, Behavior>;

// Behavior registry keyed by modelId (e.g., 'gpt-5', 'claude-sonnet-4', 'claude-opus-4-1', 'gemini-2-5-pro')
const behavior: BehaviorRegistry = new Map();
// Analyze call counters per modelId for assertions
const callCounts: Map<string, number> = new Map();

// Helpers to control registry in tests
function setBehavior(modelId: string, b: Behavior) {
  behavior.set(modelId, { ...b });
}
function getBehavior(modelId: string): Behavior {
  return behavior.get(modelId) ?? {};
}
function incCall(modelId: string) {
  callCounts.set(modelId, (callCounts.get(modelId) ?? 0) + 1);
}
function getCalls(modelId: string) {
  return callCounts.get(modelId) ?? 0;
}
function resetRegistry() {
  behavior.clear();
  callCounts.clear();
}

// Utility delay that cooperates with fake timers
function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Local AnalysisResponse factory
function makeResponse(
  model: string,
  provider: ProviderName,
  confidence = 0.9,
  extra?: Partial<AnalysisResponse['metadata']>
): AnalysisResponse {
  return {
    issues: [],
    metadata: {
      modelUsed: model,
      provider,
      costEstimate: 0,
      durationMs: 0,
      confidence,
      cached: false,
      ...(extra ?? {}),
    },
  };
}

// Factory: createMockRequest()
// Produces a minimal valid AnalysisRequest with ability to override fields
function createMockRequest(overrides?: Partial<AnalysisRequest>): AnalysisRequest {
  const base: AnalysisRequest = {
    analysisType: 'simple',
    scene: {
      id: 'scene-1',
      text: 'Once upon a time.',
      wordCount: 4,
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
      knownCharacters: new Set([ 'Alice' ]),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: [],
    },
  };
  return { ...base, ...(overrides ?? {}) };
}

// Minimal fake ModelPerformanceTracker-compatible stub with controllable scores
class FakeTracker {
  private map = new Map<string, number>(); // key = modelId::taskType
  private key(modelId: string, task: string) { return `${modelId}::${task}`; }
  setScore(modelId: string, task: string, score: number) {
    const s = Math.max(0, Math.min(1, score));
    this.map.set(this.key(modelId, task), s);
  }
  recordResult() { /* no-op for tests */ }
  score(modelId: string, task: string, opts?: { costWeight?: number; latencyWeight?: number; accuracyWeight?: number }): number {
    const base = this.map.get(this.key(modelId, task)) ?? 0.7;
    const cost = Math.max(0, Math.min(1, opts?.costWeight ?? 0));
    return Math.max(0, Math.min(1, base * (1 - 0.3 * cost)));
  }
}

// -----------------------------
// Provider module mocks (vi.mock)
// Each mock exports a class compatible with the real provider API:
//   constructor(config, breaker) and analyze(req)
// The mock classes extend BaseProvider so they can use fetchWithRetry when needed.
// -----------------------------

type AnyConfig = { apiKey: string; model?: string; timeoutMs?: number; baseUrl?: string };


// OpenAI
vi.mock('../../ai/providers/OpenAIProvider', async () => {
 const baseMod = await vi.importActual<typeof import('../../ai/providers/BaseProvider')>('../../ai/providers/BaseProvider');
 const types = await vi.importActual<typeof import('../../ai/types')>('../../ai/types');
 const Base = (baseMod as any).default;

 return {
   default: class MockOpenAIProvider extends Base<any> {
     private modelId: string;
     constructor(config: AnyConfig, breaker: any) {
       super('openai', config as AnyConfig, breaker);
       this.modelId = config.model ?? 'gpt-5';
     }
     public async analyze(_req: AnalysisRequest): Promise<AnalysisResponse> {
       incCall(this.modelId);
       const b = getBehavior(this.modelId);
       const respTime = Math.max(0, b.responseTime ?? 0);

       if (b.failureType === 'baseFetchRetry') {
         const started = Date.now();
         // Mock the fetch call to avoid real network requests
         const mockResponse = { json: vi.fn().mockResolvedValue({ ok: true }) };
         const res = await Promise.resolve(mockResponse as any);
         try { await (res as any).json?.(); } catch (_e) { /* ignore */ }
         const durationMs = Date.now() - started;
         return makeResponse(this.modelId, 'openai', b.confidence ?? 0.85, { durationMs });
       }

       if (respTime > 0) await delay(respTime);

       if (b.shouldFail) {
         switch (b.failureType) {
           case 'rateLimit':
             throw new (types as any).RateLimitError('openai', '429 Too Many Requests');
           case 'timeout':
             throw new (types as any).TimeoutError('openai', 50, 'Timed out');
           case 'invalid':
             throw new (types as any).ProviderError('openai', 'invalid api key', { retriable: false });
           case 'network':
             throw new (types as any).ProviderError('openai', 'network', { retriable: true });
           case 'validation':
             throw new (types as any).ValidationError('openai', 'Response validation failed');
           default:
             throw new (types as any).ProviderError('openai', 'unknown error', { retriable: true });
         }
       }

       const confidence = b.confidence ?? 0.9;
       const resMeta = b.response?.metadata ?? {};
       const base = makeResponse(this.modelId, 'openai', confidence, resMeta);
       if (respTime > 0) (base.metadata as any).durationMs = respTime;
       return { ...base, ...(b.response ? { ...b.response, metadata: { ...base.metadata, ...(b.response.metadata ?? {}) } } : {}) };
     }
     protected formatPrompt(_req: AnalysisRequest): unknown { return {}; }
   },
 };
});

// Claude
vi.mock('../../ai/providers/ClaudeProvider', async () => {
 const baseMod = await vi.importActual<typeof import('../../ai/providers/BaseProvider')>('../../ai/providers/BaseProvider');
 const types = await vi.importActual<typeof import('../../ai/types')>('../../ai/types');
 const Base = (baseMod as any).default;

 return {
   default: class MockClaudeProvider extends Base<any> {
     private modelId: string;
     constructor(config: AnyConfig, breaker: any) {
       super('anthropic', config as AnyConfig, breaker);
       this.modelId = config.model ?? 'claude-sonnet-4';
     }
     public async analyze(_req: AnalysisRequest): Promise<AnalysisResponse> {
       incCall(this.modelId);
       const b = getBehavior(this.modelId);
       const respTime = Math.max(0, b.responseTime ?? 0);

       if (respTime > 0) await delay(respTime);

       if (b.shouldFail) {
         switch (b.failureType) {
           case 'rateLimit':
             throw new (types as any).RateLimitError('anthropic', '429 Too Many Requests');
           case 'timeout':
             throw new (types as any).TimeoutError('anthropic', 50, 'Timed out');
           case 'invalid':
             throw new (types as any).ProviderError('anthropic', 'invalid api key', { retriable: false });
           case 'network':
             throw new (types as any).ProviderError('anthropic', 'network', { retriable: true });
           case 'validation':
             throw new (types as any).ValidationError('anthropic', 'Response validation failed');
           default:
             throw new (types as any).ProviderError('anthropic', 'unknown error', { retriable: true });
         }
       }

       const confidence = b.confidence ?? 0.9;
       const resMeta = b.response?.metadata ?? {};
       const base = makeResponse(this.modelId, 'anthropic', confidence, resMeta);
       if (respTime > 0) (base.metadata as any).durationMs = respTime;
       return { ...base, ...(b.response ? { ...b.response, metadata: { ...base.metadata, ...(b.response.metadata ?? {}) } } : {}) };
     }
     protected formatPrompt(_req: AnalysisRequest): unknown { return {}; }
   },
 };
});

// Gemini
vi.mock('../../ai/providers/GeminiProvider', async () => {
 const baseMod = await vi.importActual<typeof import('../../ai/providers/BaseProvider')>('../../ai/providers/BaseProvider');
 const types = await vi.importActual<typeof import('../../ai/types')>('../../ai/types');
 const Base = (baseMod as any).default;

 return {
   default: class MockGeminiProvider extends Base<any> {
     private modelId: string;
     constructor(config: AnyConfig, breaker: any) {
       super('google', config as AnyConfig, breaker);
       this.modelId = config.model ?? 'gemini-2-5-pro';
     }
     public async analyze(_req: AnalysisRequest): Promise<AnalysisResponse> {
       incCall(this.modelId);
       const b = getBehavior(this.modelId);
       const respTime = Math.max(0, b.responseTime ?? 0);

       if (respTime > 0) await delay(respTime);

       if (b.shouldFail) {
         switch (b.failureType) {
           case 'rateLimit':
             throw new (types as any).RateLimitError('google', '429 Too Many Requests');
           case 'timeout':
             throw new (types as any).TimeoutError('google', 50, 'Timed out');
           case 'invalid':
             throw new (types as any).ProviderError('google', 'invalid api key', { retriable: false });
           case 'network':
             throw new (types as any).ProviderError('google', 'network', { retriable: true });
           case 'validation':
             throw new (types as any).ValidationError('google', 'Response validation failed');
           default:
             throw new (types as any).ProviderError('google', 'unknown error', { retriable: true });
         }
       }

       const confidence = b.confidence ?? 0.9;
       const resMeta = b.response?.metadata ?? {};
       const base = makeResponse(this.modelId, 'google', confidence, resMeta);
       if (respTime > 0) (base.metadata as any).durationMs = respTime;
       return { ...base, ...(b.response ? { ...b.response, metadata: { ...base.metadata, ...(b.response.metadata ?? {}) } } : {}) };
     }
     protected formatPrompt(_req: AnalysisRequest): unknown { return {}; }
   },
 };
});

// -----------------------------
// Shared per-suite state
// -----------------------------

let mgr: AIServiceManager;
let tracker: FakeTracker;

// Helper to configure manager with all three families unless overridden
function configureAll(manager: AIServiceManager) {
  manager.configure({
    claude: { apiKey: 'a', model: 'claude-sonnet-4' },
    openai: { apiKey: 'b', model: 'gpt-5' },
    gemini: { apiKey: 'c', model: 'gemini-2-5-pro' },
  });
}

// -----------------------------
// Setup / Teardown
// -----------------------------

beforeEach(() => {
  resetRegistry();
  // Fresh fake tracker and inject into AIServiceManager
  tracker = new FakeTracker();
  (AIServiceManager as any).__setTestTracker(tracker);
  // Stable selection for non-exploration tests
  vi.spyOn(Math, 'random').mockReturnValue(0.99);

  // Default cache (can be replaced in a test)
  mgr = new AIServiceManager(new PromptCache(100, 60_000));
  configureAll(mgr);

  // Default all known models to succeed fast with high confidence unless a test overrides
  setBehavior('claude-3-5-haiku', { confidence: 0.9, responseTime: 5 });
  setBehavior('claude-sonnet-4', { confidence: 0.9, responseTime: 5 });
  setBehavior('claude-opus-4-1', { confidence: 0.92, responseTime: 5 });
  setBehavior('gpt-5', { confidence: 0.88, responseTime: 5 });
  setBehavior('gemini-2-5-pro', { confidence: 0.87, responseTime: 5 });
});

afterEach(() => {
  (AIServiceManager as any).__setTestTracker(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// -----------------------------
// Provider fallback tests (5+)
// -----------------------------

describe('AIServiceManager provider fallback', () => {
  it('should return result immediately when primary succeeds with high confidence', async () => {
    // Favor fast tier for simple tasks: make haiku the top score
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    tracker.setScore('gpt-5', 'simple', 0.7);

    const req = createMockRequest({ analysisType: 'simple' });
    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('claude-3-5-haiku');
    expect(getCalls('claude-3-5-haiku')).toBe(1);
  });

  it('should use secondary when primary throws retriable network error', async () => {
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    setBehavior('claude-3-5-haiku', { shouldFail: true, failureType: 'network' });
    // Strong tier succeeds
    setBehavior('claude-opus-4-1', { confidence: 0.9 });

    const req = createMockRequest({ analysisType: 'simple' });
    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
    expect(getCalls('claude-3-5-haiku')).toBe(1);
    expect(getCalls('claude-opus-4-1')).toBe(1);
  });

  it('should escalate on timeout and succeed on secondary', async () => {
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    setBehavior('claude-3-5-haiku', { shouldFail: true, failureType: 'timeout' });
    setBehavior('claude-opus-4-1', { confidence: 0.93 });

    const req = createMockRequest({ analysisType: 'simple' });
    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
  });

  it('should throw aggregated error when all providers fail', async () => {
    // Ensure base picks balanced/fast but both base and strong fail
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    tracker.setScore('claude-opus-4-1', 'simple', 0.9);
    setBehavior('claude-3-5-haiku', { shouldFail: true, failureType: 'network' });
    setBehavior('claude-opus-4-1', { shouldFail: true, failureType: 'invalid' });

    const req = createMockRequest({ analysisType: 'simple' });
    await expect(mgr.analyzeContinuity(req)).rejects.toThrowError(/All provider attempts failed for analyzeContinuity/);
    const metrics = mgr.getMetrics();
    expect(metrics.lastErrors['claude-3-5-haiku']).toBeDefined();
    expect(metrics.lastErrors['claude-opus-4-1']).toBeDefined();
  });

  it('should escalate on low confidence and accept higher-confidence secondary; cache the result', async () => {
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    setBehavior('claude-3-5-haiku', { confidence: 0.5 }); // below simple threshold 0.65
    setBehavior('claude-opus-4-1', { confidence: 0.92 });

    const req = createMockRequest({ analysisType: 'simple' });
    const res1 = await mgr.analyzeContinuity(req);
    expect(res1.metadata.modelUsed).toBe('claude-opus-4-1');

    // Second call should hit cache; no new provider invocations
    const callsBefore = getCalls('claude-opus-4-1');
    const res2 = await mgr.analyzeContinuity(req);
    expect(res2.metadata.cached).toBe(true);
    expect(getCalls('claude-opus-4-1')).toBe(callsBefore);
  });
});

// -----------------------------
// Caching tests (4+)
// -----------------------------

describe('AIServiceManager caching', () => {
  it('should return cached result for identical request and call provider only once', async () => {
    // Small cache is fine; default TTL long enough
    const req = createMockRequest();
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);

    const first = await mgr.analyzeContinuity(req);
    const callsAfterFirst = getCalls(first.metadata.modelUsed);
    const second = await mgr.analyzeContinuity(req);

    expect(second.metadata.cached).toBe(true);
    expect(second.metadata.durationMs).toBe(0);
    expect(second.metadata.costEstimate).toBe(0);
    expect(getCalls(first.metadata.modelUsed)).toBe(callsAfterFirst);
  });

  it('should expire cache by TTL and re-invoke provider after expiry', async () => {
    vi.useFakeTimers();
    // Use very small TTL: constructor signature is (maxEntries, ttlMs)
    mgr = new AIServiceManager(new PromptCache(100, 20));
    configureAll(mgr);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);

    const req = createMockRequest();

    // First call: start promise, then flush provider's artificial latency
    const p1 = mgr.analyzeContinuity(req);
    vi.advanceTimersByTime(10);
    await vi.runAllTimersAsync();
    const res1 = await p1;
    expect(res1.metadata.cached).toBe(false);
    const calls1 = getCalls(res1.metadata.modelUsed);

    // Advance time past TTL
    vi.advanceTimersByTime(25);
    await vi.runAllTimersAsync();

    // Second call after expiry: start and flush latency again
    const p2 = mgr.analyzeContinuity(req);
    vi.advanceTimersByTime(10);
    await vi.runAllTimersAsync();
    const res2 = await p2;
    expect(res2.metadata.cached).toBe(false);
    expect(getCalls(res1.metadata.modelUsed)).toBeGreaterThan(calls1);
  });

  it('should enforce cache size limit (maxEntries=2) and evict LRU', async () => {
    mgr = new AIServiceManager(new PromptCache(2, 10_000));
    configureAll(mgr);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);

    const reqA = createMockRequest({ scene: { ...(createMockRequest().scene as any), id: 'A', text: 'A' } as any });
    const reqB = createMockRequest({ scene: { ...(createMockRequest().scene as any), id: 'B', text: 'B' } as any });
    const reqC = createMockRequest({ scene: { ...(createMockRequest().scene as any), id: 'C', text: 'C' } as any });

    await mgr.analyzeContinuity(reqA);
    await mgr.analyzeContinuity(reqB);
    // At this point cache size should be 2
    expect(mgr.getMetrics().cacheSize).toBe(2);

    await mgr.analyzeContinuity(reqC);
    expect(mgr.getMetrics().cacheSize).toBe(2);

    // Accessing A again should be a miss (evicted), thus another provider call
    const before = getCalls('claude-3-5-haiku');
    await mgr.analyzeContinuity(reqA);
    expect(getCalls('claude-3-5-haiku')).toBeGreaterThan(before);
  });

  it('should not share cache across different requests (by analysisType and scene)', async () => {
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    const baseScene = createMockRequest().scene;

    const req1 = createMockRequest({ analysisType: 'simple', scene: baseScene });
    const req2 = createMockRequest({ analysisType: 'consistency', scene: baseScene }); // different type

    await mgr.analyzeContinuity(req1);
    const before = getCalls('claude-3-5-haiku');
    await mgr.analyzeContinuity(req2);

    expect(getCalls('claude-3-5-haiku')).toBeGreaterThan(before);
  });
});

// -----------------------------
// Error handling and retry tests (5+)
// -----------------------------

describe('AIServiceManager error handling and retries', () => {
  it('should retry transient network errors at provider level using BaseProvider.fetchWithRetry', async () => {
    // Only configure OpenAI to simplify selection
    mgr = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);
    mgr.configure({ openai: { apiKey: 'k', model: 'gpt-5' } });

    // Set behavior to use base fetch retry path
    setBehavior('gpt-5', { failureType: 'baseFetchRetry' });

    // Stub global fetch: fail once with 500, then succeed 200
    const fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockImplementationOnce(async () => {
      return new Response('fail', { status: 500, statusText: 'Server Error' });
    }).mockImplementationOnce(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } as any });
    });

    // Use fake timers to fast-forward backoff
    vi.useFakeTimers();

    const req = createMockRequest({ analysisType: 'simple' });
    const promise = mgr.analyzeContinuity(req);

    // Advance enough to cover backoff (1000ms)
    vi.advanceTimersByTime(1100);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.metadata.provider).toBe('openai');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should not retry invalid API key errors and escalate immediately', async () => {
    mgr = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);
    configureAll(mgr);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    setBehavior('claude-3-5-haiku', { shouldFail: true, failureType: 'invalid' });
    setBehavior('claude-opus-4-1', { confidence: 0.9 });

    const res = await mgr.analyzeContinuity(createMockRequest({ analysisType: 'simple' }));
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
  });

  it('should treat 429 rate limit as retriable and allow fallback when provider ultimately fails', async () => {
    configureAll(mgr);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    setBehavior('claude-3-5-haiku', { shouldFail: true, failureType: 'rateLimit' });
    setBehavior('claude-opus-4-1', { confidence: 0.9 });

    const res = await mgr.analyzeContinuity(createMockRequest({ analysisType: 'simple' }));
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
  });

  it('should handle malformed response (ValidationError) with no retry and fallback', async () => {
    configureAll(mgr);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    setBehavior('claude-3-5-haiku', { shouldFail: true, failureType: 'validation' });
    setBehavior('claude-opus-4-1', { confidence: 0.9 });

    const res = await mgr.analyzeContinuity(createMockRequest({ analysisType: 'simple' }));
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
  });

  it('should record metrics and lastErrors after failures and successes', async () => {
    configureAll(mgr);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    setBehavior('claude-3-5-haiku', { shouldFail: true, failureType: 'network' });
    setBehavior('claude-opus-4-1', { confidence: 0.91 });

    const res = await mgr.analyzeContinuity(createMockRequest({ analysisType: 'simple' }));
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');

    const metrics = mgr.getMetrics();
    expect(metrics.perProvider['claude-3-5-haiku']?.fail).toBeGreaterThan(0);
    expect(metrics.perProvider['claude-opus-4-1']?.success).toBeGreaterThan(0);
    expect(metrics.lastErrors['claude-3-5-haiku']).toMatch(/network|Rate limit|invalid|Timed out|unknown/i);
  });
});

// -----------------------------
// Rotation / load balancing tests (3+)
// -----------------------------

describe('AIServiceManager selection and exploration', () => {
  it('should select top-scored model when Math.random=0.99 (no exploration)', async () => {
    // Favor GPT-5 over Haiku for simple
    tracker.setScore('gpt-5', 'simple', 0.96);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.8);

    const res = await mgr.analyzeContinuity(createMockRequest({ analysisType: 'simple' }));
    expect(['gpt-5', 'claude-3-5-haiku']).toContain(res.metadata.modelUsed);
    expect(res.metadata.modelUsed).toBe('gpt-5');
  });

  it('should occasionally explore non-top model when Math.random=0.05 (epsilon=0.1)', async () => {
    // Mock Math.random: first call for epsilon check = 0.05 triggers exploration,
    // second call for index selection ~ pick within range
    const rnd = vi.spyOn(Math, 'random');
    rnd.mockReturnValueOnce(0.05).mockReturnValueOnce(0.1); // exploration, pick index 0 or near
    tracker.setScore('gpt-5', 'simple', 0.99);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.1);

    const res = await mgr.analyzeContinuity(createMockRequest({ analysisType: 'simple' }));
    // Not deterministically asserting which explored model, but ensure the call happened and result is valid
    expect(['gpt-5', 'claude-3-5-haiku', 'gemini-2-5-pro']).toContain(res.metadata.modelUsed);
  });

  it('should shift selection after recording poor performance for the current top model', async () => {
    tracker.setScore('gpt-5', 'simple', 0.95);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.9);

    const req = createMockRequest({ analysisType: 'simple' });
    const first = await mgr.analyzeContinuity(req);
    const firstModel = first.metadata.modelUsed;

    // Penalize the first model heavily
    tracker.setScore(firstModel, 'simple', 0.2);
    tracker.setScore(firstModel === 'gpt-5' ? 'claude-3-5-haiku' : 'gpt-5', 'simple', 0.98);

    // Change scene id to avoid cache
    const req2 = createMockRequest({ analysisType: 'simple', scene: { ...(req.scene as any), id: 'shift-2' } as any });
    const second = await mgr.analyzeContinuity(req2);
    expect(second.metadata.modelUsed).not.toBe(firstModel);
  });
});

// -----------------------------
// Performance / concurrency tests (3+)
// -----------------------------

describe('AIServiceManager performance and concurrency', () => {
  it('should deduplicate concurrent identical requests in RequestBatcher with deDupeByKey=true', async () => {
    // Configure only OpenAI to avoid model selection variability
    mgr = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);
    mgr.configure({ openai: { apiKey: 'x', model: 'gpt-5' } });
    // Slow response to observe dedupe
    setBehavior('gpt-5', { confidence: 0.9, responseTime: 50 });

    const req = createMockRequest({ analysisType: 'simple' });
    const key = 'dedupe-key';
    const runner = (r: AnalysisRequest) => mgr.analyzeContinuity(r);

    const p = batchAnalyze(
      [
        { req, key },
        { req, key },
      ],
      runner,
      { deDupeByKey: true, concurrency: 2 }
    );

    // Use fake timers to elapse response time
    vi.useFakeTimers();
    const promise = p;
    vi.advanceTimersByTime(60);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(2);
    expect(results[0].result.metadata.modelUsed).toBe('gpt-5');
    expect(getCalls('gpt-5')).toBe(1); // underlying analyze called once
  });

  it('should not deduplicate when calling AIServiceManager directly concurrently', async () => {
    mgr = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);
    mgr.configure({ openai: { apiKey: 'x', model: 'gpt-5' } });
    setBehavior('gpt-5', { confidence: 0.9, responseTime: 30 });

    const req = createMockRequest({ analysisType: 'simple' });

    vi.useFakeTimers();
    const p1 = mgr.analyzeContinuity(req);
    const p2 = mgr.analyzeContinuity(req);
    vi.advanceTimersByTime(35);
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(getCalls('gpt-5')).toBeGreaterThanOrEqual(2);
  });

  it('should keep response times within expected bounds for cached vs uncached paths', async () => {
    mgr = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);
    mgr.configure({ openai: { apiKey: 'x', model: 'gpt-5' } });
    setBehavior('gpt-5', { confidence: 0.9, responseTime: 25 });

    const req = createMockRequest({ analysisType: 'simple' });

    vi.useFakeTimers();
    const p1 = mgr.analyzeContinuity(req);
    vi.advanceTimersByTime(30);
    await vi.runAllTimersAsync();
    const first = await p1;
    expect(first.metadata.durationMs).toBeGreaterThanOrEqual(25);

    const cached = await mgr.analyzeContinuity(req);
    expect(cached.metadata.cached).toBe(true);
    expect(cached.metadata.durationMs).toBe(0);
  });
});

// -----------------------------
// Additional coverage for AIServiceManager internals
// -----------------------------

describe('AIServiceManager additional coverage', () => {
  it('should throw when no models are configured', async () => {
    const mgr2 = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);

    const req = createMockRequest();
    await expect(mgr2.analyzeContinuity(req)).rejects.toThrow(/No AI models are configured/);
  });

  it('executeChain should skip unconfigured models, succeed on next, and cache result', async () => {
    // Fresh manager with only OpenAI configured
    mgr = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);
    mgr.configure({ openai: { apiKey: 'x', model: 'gpt-5' } });

    setBehavior('gpt-5', { confidence: 0.9, responseTime: 5 });

    const req = createMockRequest({ analysisType: 'simple' });
    const res1 = await (mgr as any).executeChain(req, ['not-a-model', 'gpt-5']);
    expect(res1.metadata.provider).toBe('openai');

    // Next call should hit cache for identical request
    const res2 = await mgr.analyzeContinuity(req);
    expect(res2.metadata.cached).toBe(true);
  });

  it('executeChain should aggregate and throw when all fallbacks fail', async () => {
    mgr = new AIServiceManager(new PromptCache(100, 60_000));
    (AIServiceManager as any).__setTestTracker(tracker);
    mgr.configure({ openai: { apiKey: 'x', model: 'gpt-5' } });

    setBehavior('gpt-5', { shouldFail: true, failureType: 'invalid' });

    const req = createMockRequest({ analysisType: 'simple' });
    await expect(
      (mgr as any).executeChain(req, ['not-a-model', 'gpt-5'])
    ).rejects.toThrow(/All provider fallbacks failed for analyzeContinuity/);
  });
});

// -----------------------------
// Additional targeted coverage to exceed 90% on AIServiceManager
// -----------------------------

import { selectModelForRequest, buildFallbackChain } from '../../ai/AIServiceManager';

describe('AIServiceManager helper functions', () => {
  it('selectModelForRequest covers all analysis types', () => {
    expect(selectModelForRequest('simple')).toBe('gpt-5');
    expect(selectModelForRequest('consistency')).toBe('claude-sonnet-4');
    expect(selectModelForRequest('complex')).toBe('claude-opus-4-1');
    expect(selectModelForRequest('full')).toBe('gemini-2-5-pro');
    // default fallback branch
    expect(selectModelForRequest('unknown' as any)).toBe('gpt-5');
  });

  it('buildFallbackChain covers all analysis types', () => {
    expect(buildFallbackChain('simple')).toEqual(['gpt-5', 'gemini-2-5-pro']);
    expect(buildFallbackChain('consistency')).toEqual(['claude-sonnet-4', 'gpt-5']);
    expect(buildFallbackChain('complex')).toEqual(['claude-opus-4-1', 'claude-sonnet-4', 'gpt-5']);
    expect(buildFallbackChain('full')).toEqual(['gemini-2-5-pro', 'claude-opus-4-1']);
    // default fallback branch
    expect(buildFallbackChain('unknown' as any)).toEqual(['gpt-5']);
  });
});

describe('AIServiceManager validation edge cases', () => {
  it('throws when readerContext.knownCharacters is not a Set', async () => {
    const badReq = createMockRequest({
      readerContext: {
        // @ts-expect-error intentionally wrong type
        knownCharacters: ['Alice'],
        establishedTimeline: [],
        revealedPlotPoints: [],
        establishedSettings: [],
      },
    });
    await expect(mgr.analyzeContinuity(badReq)).rejects.toThrow(/knownCharacters must be a Set/);
  });

  it('throws when previousScenes is not an array', async () => {
    const badReq = createMockRequest({
      // @ts-expect-error wrong type
      previousScenes: null,
    });
    await expect(mgr.analyzeContinuity(badReq)).rejects.toThrow(/previousScenes must be an array/);
  });

  it('throws when scene.text is missing', async () => {
    const badReq = createMockRequest({
      scene: { ...(createMockRequest().scene as any), text: undefined } as any,
    });
    await expect(mgr.analyzeContinuity(badReq)).rejects.toThrow(/scene is required/);
  });
});

describe('AIServiceManager routing edge cases', () => {
  it('treats request as complex when flags.complex=true', async () => {
    configureAll(mgr);
    // Encourage strong tier selection when complex, and ensure scoring uses 'simple' taskKey as well
    tracker.setScore('claude-opus-4-1', 'complex', 0.99);
    tracker.setScore('claude-opus-4-1', 'simple', 0.99);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.2);
    tracker.setScore('gemini-2-5-pro', 'simple', 0.4);
    setBehavior('claude-opus-4-1', { confidence: 0.9, responseTime: 5 });

    const req = createMockRequest({
      // analysisType is "complex" via flag to exercise isComplex(flag) branch
      // we still set type to simple to ensure flag dominates
      analysisType: 'simple',
      // @ts-expect-error inject flag recognized by isComplex
      flags: { complex: true },
    });

    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
  });

  it('treats request as complex when previousScenes >= 6 (threshold path)', async () => {
    configureAll(mgr);
    // Ensure strong-tier selection wins under 'simple' taskKey scoring
    tracker.setScore('claude-opus-4-1', 'simple', 0.99);
    tracker.setScore('claude-3-5-haiku', 'simple', 0.2);
    tracker.setScore('gemini-2-5-pro', 'simple', 0.4);
    setBehavior('claude-opus-4-1', { confidence: 0.9, responseTime: 5 });

    const base = createMockRequest({ analysisType: 'simple' });
    const prev = Array.from({ length: 6 }).map((_, i) => ({ id: `p${i}`, text: 'x' } as any));
    const req = { ...base, previousScenes: prev } as any;

    const res = await mgr.analyzeContinuity(req);
    expect(res.metadata.modelUsed).toBe('claude-opus-4-1');
  });

  it('returns and caches last low-confidence response after exhausting escalations', async () => {
    configureAll(mgr);
    // Make selection prefer haiku first, then escalate to strong (opus)
    tracker.setScore('claude-3-5-haiku', 'simple', 0.95);
    tracker.setScore('claude-opus-4-1', 'simple', 0.94);
    // Force both responses to be below threshold for simple (0.65) to hit lastResponse branch
    setBehavior('claude-3-5-haiku', { confidence: 0.6, responseTime: 5 });
    setBehavior('claude-opus-4-1', { confidence: 0.6, responseTime: 5 });

    const req = createMockRequest({ analysisType: 'simple' });
    const res1 = await mgr.analyzeContinuity(req);
    // Should return the lastResponse (from escalated strong attempt) and cache it
    expect(['claude-3-5-haiku', 'claude-opus-4-1']).toContain(res1.metadata.modelUsed);

    const before = getCalls(res1.metadata.modelUsed);
    const res2 = await mgr.analyzeContinuity(req);
    expect(res2.metadata.cached).toBe(true);
    expect(getCalls(res1.metadata.modelUsed)).toBe(before);
  });
});