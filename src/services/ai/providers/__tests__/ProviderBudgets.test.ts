import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenAIProvider from '../OpenAIProvider';
import CircuitBreaker from '../../utils/CircuitBreaker';
import type { AnalysisRequest } from '../../types';

function makeLongText(n: number): string {
  return 'X'.repeat(n);
}

function makeReq(prevCount: number, prevLen: number, sceneLen: number): AnalysisRequest {
  const previousScenes = Array.from({ length: prevCount }, (_v, i) => ({
    id: `p${i}`,
    text: makeLongText(prevLen),
    wordCount: prevLen / 5,
    position: i,
    originalPosition: i,
    characters: [],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: false,
    rewriteStatus: 'pending' as const,
  }));

  return {
    scene: {
      id: 's1',
      text: makeLongText(sceneLen),
      wordCount: sceneLen / 5,
      position: 10,
      originalPosition: 10,
      characters: [],
      timeMarkers: [],
      locationMarkers: [],
      hasBeenMoved: false,
      rewriteStatus: 'pending',
    },
    previousScenes,
    analysisType: 'simple',
    readerContext: {
      knownCharacters: new Set<string>(),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: [],
    },
  };
}

function fakeOpenAIResponse(usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  const payload = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            issues: [],
            summary: '',
            confidence: 0.9,
          }),
        },
      },
    ],
    usage: usage ?? {
      prompt_tokens: 120,
      completion_tokens: 40,
    },
  };
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  } as any;
}

describe('Provider budgets and cost meta', () => {
  const envBackup = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    // Configure small per-request budget to trigger trimming
    process.env.MAX_INPUT_TOKENS_PER_REQUEST = '200'; // small
    delete process.env.HARD_FAIL_ON_BUDGET;
  });

  afterEach(() => {
    // restore env
    for (const k of Object.keys(process.env)) delete (process.env as any)[k];
    Object.assign(process.env, envBackup);
    vi.restoreAllMocks();
  });

  it('adds estimated cost and trimming meta when budgets are configured (OpenAI)', async () => {
    const breaker = new CircuitBreaker();
    const provider = new OpenAIProvider(
      { apiKey: 'test', model: 'gpt-4o' },
      breaker
    );

    // Stub network call
    const spy = vi
      .spyOn(provider as any, 'fetchWithRetry')
      .mockResolvedValue(fakeOpenAIResponse({ prompt_tokens: 180, completion_tokens: 55 }));

    // Request with large previousScenes to force trimming
    const req = makeReq(5, 1000, 1200);

    const res = await provider.analyze(req);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.metadata).toBeTruthy();
    expect(res.metadata.modelUsed).toBe('gpt-4o');
    // costEstimate should be positive given usage and pricing
    expect(res.metadata.costEstimate).toBeGreaterThan(0);

    // Non-breaking extra meta fields (best-effort)
    const metaAny = res.metadata as any;
    expect(metaAny.tokensInputEstimated).toBeGreaterThan(0);
    expect(metaAny.tokensOutputEstimated).toBeGreaterThanOrEqual(0);
    expect(metaAny.costBreakdownUSD).toBeTruthy();

    // Trimming flags present when budget applied
    expect(metaAny.trimmed || metaAny.trimDetails).toBeTruthy();
    if (metaAny.trimDetails) {
      expect(metaAny.trimDetails.beforeTokens).toBeGreaterThan(metaAny.trimDetails.afterTokens);
      expect(metaAny.trimDetails.budget).toBe(Number(process.env.MAX_INPUT_TOKENS_PER_REQUEST));
    }
  });

  it('does not throw when budget exceeded and HARD_FAIL_ON_BUDGET is not set', async () => {
    const breaker = new CircuitBreaker();
    const provider = new OpenAIProvider(
      { apiKey: 'test', model: 'gpt-4o' },
      breaker
    );
    vi.spyOn(provider as any, 'fetchWithRetry').mockResolvedValue(fakeOpenAIResponse());

    // Make scene extremely large such that even after trimming, it could exceed small budget
    const req = makeReq(10, 5000, 50_000);

    const res = await provider.analyze(req);
    expect(res.issues).toBeDefined();
    const metaAny = res.metadata as any;
    expect(metaAny.trimmed || metaAny.trimDetails).toBeTruthy();
  });
});