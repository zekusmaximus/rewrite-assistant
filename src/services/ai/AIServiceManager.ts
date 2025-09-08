import {
  AnalysisRequest,
  AnalysisResponse,
  AnalysisType,
  ClaudeConfig,
  OpenAIConfig,
  GeminiConfig,
  ModelCapabilities,
  ProviderError,
  ProviderName,
} from './types';
import PromptCache from './cache/PromptCache';
import CircuitBreaker from './utils/CircuitBreaker';
import ClaudeProvider from './providers/ClaudeProvider';
import OpenAIProvider from './providers/OpenAIProvider';
import GeminiProvider from './providers/GeminiProvider';
import BaseProvider from './providers/BaseProvider';
import ModelPerformanceTracker from './optimization/ModelPerformanceTracker';

/**
 * Model capability registry used for routing and fallbacks.
 */
const CAPABILITIES: Record<string, ModelCapabilities> = {
  'claude-3-5-haiku': {
    model: 'claude-3-5-haiku',
    provider: 'anthropic',
    strengths: ['narrative-flow', 'character-voice', 'instruction-following'],
    costTier: 'low',
  },
  'claude-sonnet-4': {
    model: 'claude-sonnet-4',
    provider: 'anthropic',
    strengths: ['narrative-flow', 'character-voice'],
    costTier: 'medium',
  },
  'claude-opus-4-1': {
    model: 'claude-opus-4-1',
    provider: 'anthropic',
    strengths: ['complex-reasoning', 'deep-analysis'],
    costTier: 'high',
  },
  'gpt-5': {
    model: 'gpt-5',
    provider: 'openai',
    strengths: ['instruction-following', 'validation'],
    costTier: 'low',
  },
  'gemini-2-5-pro': {
    model: 'gemini-2-5-pro',
    provider: 'google',
    strengths: ['full-manuscript', 'bulk-analysis'],
    costTier: 'low',
  },
};

type ProviderByModel = Map<string, BaseProvider<any>>;

/**
 * Registry describing available models and basic traits.
 * Only models instantiated in this.providers are considered "configured".
 */
type Tier = 'fast' | 'balanced' | 'strong';
type ProviderType = 'claude' | 'openai' | 'gemini';
interface RegistryModel {
  id: string;
  providerType: ProviderType;
  tier: Tier;
  relativeCost: 1 | 2 | 3;
  maxContextTokens?: number;
}

const MODEL_REGISTRY: RegistryModel[] = [
  { id: 'claude-3-5-haiku', providerType: 'claude', tier: 'fast', relativeCost: 1 },
  { id: 'claude-sonnet-4', providerType: 'claude', tier: 'balanced', relativeCost: 2 },
  { id: 'claude-opus-4-1', providerType: 'claude', tier: 'strong', relativeCost: 3 },
  { id: 'gpt-5', providerType: 'openai', tier: 'balanced', relativeCost: 2 },
  { id: 'gemini-2-5-pro', providerType: 'gemini', tier: 'balanced', relativeCost: 1 },
];

function configuredCandidates(providers: ProviderByModel): RegistryModel[] {
  return MODEL_REGISTRY.filter((m) => providers.has(m.id));
}

interface ConfigureOptions {
  claude?: ClaudeConfig;
  openai?: OpenAIConfig;
  gemini?: GeminiConfig;
}

interface ProviderMetrics {
  success: number;
  fail: number;
}

interface Metrics {
  totalRequests: number;
  cacheHitRate: number;
  cacheSize: number;
  perProvider: Record<string, ProviderMetrics>;
  avgDurationPerType: Record<AnalysisType, number>;
  lastErrors: Record<string, string>;
}

/**
 * Helper: choose preferred model for a given analysis type.
 */
export function selectModelForRequest(analysisType: AnalysisType): string {
  switch (analysisType) {
    case 'simple':
      return 'gpt-5';
    case 'consistency':
      return 'claude-sonnet-4';
    case 'complex':
      return 'claude-opus-4-1';
    case 'full':
      return 'gemini-2-5-pro';
    default:
      return 'gpt-5';
  }
}

/**
 * Helper: build fallback chain for a given analysis type.
 */
export function buildFallbackChain(analysisType: AnalysisType): string[] {
  switch (analysisType) {
    case 'simple':
      return ['gpt-5', 'gemini-2-5-pro'];
    case 'consistency':
      return ['claude-sonnet-4', 'gpt-5'];
    case 'complex':
      return ['claude-opus-4-1', 'claude-sonnet-4', 'gpt-5'];
    case 'full':
      return ['gemini-2-5-pro', 'claude-opus-4-1'];
    default:
      return ['gpt-5'];
  }
}

/**
 * Manages AI providers, routing, caching, and metrics for continuity analysis.
 */
export class AIServiceManager {
  private providers: ProviderByModel = new Map();
  private breaker: CircuitBreaker;
  private cache: PromptCache;
  // Internal performance tracker singleton (overridable in tests only)
  private static __testTracker: ModelPerformanceTracker | null = null;
  private tracker: ModelPerformanceTracker;
 
  private perProviderMetrics: Record<string, ProviderMetrics> = {};
  private typeDurations: Record<AnalysisType, { total: number; count: number }> = {
    simple: { total: 0, count: 0 },
    consistency: { total: 0, count: 0 },
    complex: { total: 0, count: 0 },
    full: { total: 0, count: 0 },
  };
  private _totalRequests = 0;
  private lastErrors: Record<string, string> = {};
 
  constructor(cache?: PromptCache, breaker?: CircuitBreaker) {
    this.cache = cache ?? new PromptCache(100, 5 * 60_000);
    this.breaker = breaker ?? new CircuitBreaker();
    this.tracker = AIServiceManager.__testTracker ?? new ModelPerformanceTracker();
  }

  /** @internal for unit tests only */
  public static __setTestTracker(tracker: ModelPerformanceTracker | null) {
    AIServiceManager.__testTracker = tracker;
  }

  /**
   * Configure providers and instantiate per-model clients as needed.
   * TODO: Integrate Electron safeStorage for API keys at a later stage.
   */
  public configure(config: ConfigureOptions): void {
    this.providers.clear();
    // Share the same breaker per provider family (per requirements).
    if (config.claude?.apiKey) {
      this.createClaudeInstances(config.claude);
    }
    if (config.openai?.apiKey) {
      this.createOpenAIInstances(config.openai);
    }
    if (config.gemini?.apiKey) {
      this.createGeminiInstances(config.gemini);
    }
  }

  /**
   * Execute continuity analysis with adaptive model selection, thresholds, and limited escalation.
   * Cache keys remain based solely on request identity.
   */
  public async analyzeContinuity(req: AnalysisRequest): Promise<AnalysisResponse> {
    this._totalRequests++;
    this.ensureValidRequest(req);
    const hit = this.tryCache(req);
    if (hit) return hit;

    const candidates = configuredCandidates(this.providers);
    if (candidates.length === 0) {
      throw new ProviderError('openai', 'No AI models are configured');
    }

    const taskKey = deriveTaskTypeKey(req);
    const baseModelId = selectModel(req, candidates, this.tracker);
    const maxEscalations = 2;
    let attempts = 0;
    let lastError: unknown;
    let lastProviderName: ProviderName | undefined;
    let lastResponse: AnalysisResponse | null = null;

    const tryInvoke = async (modelId: string): Promise<AnalysisResponse> => {
      const provider = this.providers.get(modelId);
      if (!provider) {
        this.recordFailure(modelId, `Provider for model "${modelId}" not configured`);
        throw new ProviderError(
          CAPABILITIES[modelId]?.provider ?? 'openai',
          `Provider for model "${modelId}" not configured`
        );
      }
      lastProviderName = CAPABILITIES[modelId]?.provider;
      const started = Date.now();
      try {
        const response = await this.invokeProvider(provider, modelId, req);
        // Record to tracker (success)
        this.tracker.recordResult(modelId, taskKey, {
          confidence: response.metadata.confidence ?? 0,
          latencyMs: response.metadata.durationMs ?? Date.now() - started,
          success: true,
        });
        return response;
      } catch (err) {
        // Record to tracker (failure)
        const dur = Date.now() - started;
        this.tracker.recordResult(modelId, taskKey, {
          confidence: 0,
          latencyMs: dur,
          success: false,
        });
        this.lastErrors[modelId] = (err as Error)?.message ?? String(err);
        this.recordFailure(modelId, this.lastErrors[modelId]);
        throw err;
      }
    };

    // First attempt using base selection
    try {
      lastResponse = await tryInvoke(baseModelId);
      const threshold = confidenceThreshold(taskKey, isComplex(req));
      if ((lastResponse.metadata.confidence ?? 0) >= threshold) {
        this.cache.set(req, lastResponse);
        return lastResponse;
      }
    } catch (e) {
      lastError = e;
    }

    // Escalate to stronger tier(s) if needed
    while (attempts < maxEscalations) {
      attempts++;
      const strongerPool = candidates.filter((c) => c.tier === 'strong');
      if (strongerPool.length === 0) break;
      const nextId = selectModel(req, strongerPool, this.tracker);
      try {
        lastResponse = await tryInvoke(nextId);
        const threshold = confidenceThreshold(taskKey, true);
        if ((lastResponse.metadata.confidence ?? 0) >= threshold) {
          this.cache.set(req, lastResponse);
          return lastResponse;
        }
      } catch (e) {
        lastError = e;
        continue;
      }
    }

    // If we have some response (even below threshold), return and cache it to avoid repeated work
    if (lastResponse) {
      this.cache.set(req, lastResponse);
      return lastResponse;
    }

    const prov: ProviderName = lastProviderName ?? 'openai';
    throw new ProviderError(prov, 'All provider attempts failed for analyzeContinuity', {
      cause: lastError,
      retriable: false,
    });
  }

  /**
   * Expose metrics for diagnostics and tests.
   */
  public getMetrics(): Metrics {
    const cacheStats = this.cache.stats();
    const avgDurationPerType: Record<AnalysisType, number> = {
      simple: this.avgDur('simple'),
      consistency: this.avgDur('consistency'),
      complex: this.avgDur('complex'),
      full: this.avgDur('full'),
    };
    return {
      totalRequests: this._totalRequests,
      cacheHitRate: cacheStats.hitRate,
      cacheSize: cacheStats.size,
      perProvider: this.perProviderMetrics,
      avgDurationPerType,
      lastErrors: this.lastErrors,
    };
  }

  // ---------- Internal helpers (kept small to satisfy max function length) ----------

  private tryCache(req: AnalysisRequest): AnalysisResponse | null {
    const cached = this.cache.get<AnalysisResponse>(req);
    return cached ? this.withCachedMetadata(cached) : null;
  }

  private async executeChain(req: AnalysisRequest, chain: string[]): Promise<AnalysisResponse> {
    let lastError: unknown;
    let lastProviderName: ProviderName | undefined;

    for (const model of chain) {
      const provider = this.providers.get(model);
      if (!provider) {
        this.recordFailure(model, `Provider for model "${model}" not configured`);
        continue;
      }
      lastProviderName = CAPABILITIES[model]?.provider;
      try {
        const response = await this.invokeProvider(provider, model, req);
        this.cache.set(req, response);
        return response;
      } catch (err) {
        // TODO: Replace console.log with production logger
        console.log(`[AIServiceManager] analyze via ${model} failed:`, err);
        lastError = err;
        this.lastErrors[model] = (err as Error)?.message ?? String(err);
        this.recordFailure(model, this.lastErrors[model]);
        continue;
      }
    }

    const prov: ProviderName = lastProviderName ?? 'openai';
    throw new ProviderError(prov, 'All provider fallbacks failed for analyzeContinuity', {
      cause: lastError,
      retriable: false,
    });
  }

  private async invokeProvider(
    provider: BaseProvider<any>,
    model: string,
    req: AnalysisRequest
  ): Promise<AnalysisResponse> {
    const started = Date.now();
    const result = await provider.analyze(req);
    const duration = Date.now() - started;
    const final = this.buildFinalResponse(model, result, duration);
    this.recordSuccess(model, req.analysisType, duration);
    return final;
  }

  private buildFinalResponse(
    model: string,
    result: AnalysisResponse,
    durationMs: number
  ): AnalysisResponse {
    return {
      issues: result.issues,
      metadata: {
        modelUsed: model,
        provider: CAPABILITIES[model]?.provider ?? result.metadata.provider,
        costEstimate: result.metadata.costEstimate,
        durationMs,
        confidence: result.metadata.confidence,
        cached: false,
      },
    };
  }

  private createClaudeInstances(base: ClaudeConfig): void {
    const haikuCfg: ClaudeConfig = { ...base, model: 'claude-3-5-haiku' };
    const sonnetCfg: ClaudeConfig = { ...base, model: 'claude-sonnet-4' };
    const opusCfg: ClaudeConfig = { ...base, model: 'claude-opus-4-1' };
    this.providers.set('claude-3-5-haiku', new ClaudeProvider(haikuCfg, this.breaker));
    this.providers.set('claude-sonnet-4', new ClaudeProvider(sonnetCfg, this.breaker));
    this.providers.set('claude-opus-4-1', new ClaudeProvider(opusCfg, this.breaker));
  }

  private createOpenAIInstances(base: OpenAIConfig): void {
    const gptCfg: OpenAIConfig = { ...base, model: 'gpt-5' };
    this.providers.set('gpt-5', new OpenAIProvider(gptCfg, this.breaker));
  }

  private createGeminiInstances(base: GeminiConfig): void {
    const proCfg: GeminiConfig = { ...base, model: 'gemini-2-5-pro' };
    this.providers.set('gemini-2-5-pro', new GeminiProvider(proCfg, this.breaker));
  }

  private withCachedMetadata(cached: AnalysisResponse): AnalysisResponse {
    return {
      issues: cached.issues,
      metadata: {
        ...cached.metadata,
        costEstimate: 0,
        durationMs: 0,
        cached: true,
      },
    };
  }

  private ensureValidRequest(req: AnalysisRequest): void {
    if (!req || typeof req !== 'object') {
      throw new Error('Invalid AnalysisRequest');
    }
    if (!req.scene || typeof req.scene.text !== 'string') {
      throw new Error('AnalysisRequest.scene is required');
    }
    if (!Array.isArray(req.previousScenes)) {
      throw new Error('AnalysisRequest.previousScenes must be an array');
    }
    if (!req.readerContext || !(req.readerContext.knownCharacters instanceof Set)) {
      // Note: do not coerce Set here; upstream should provide correct type.
      throw new Error('AnalysisRequest.readerContext.knownCharacters must be a Set');
    }
  }

  private recordSuccess(model: string, type: AnalysisType, durationMs: number): void {
    const mp = (this.perProviderMetrics[model] ??= { success: 0, fail: 0 });
    mp.success++;
    const bucket = this.typeDurations[type];
    bucket.total += durationMs;
    bucket.count++;
  }

  private recordFailure(model: string, _reason: string): void {
    const mp = (this.perProviderMetrics[model] ??= { success: 0, fail: 0 });
    mp.fail++;
  }

  private avgDur(type: AnalysisType): number {
    const b = this.typeDurations[type];
    return b.count === 0 ? 0 : Math.round(b.total / b.count);
  }
}

// ---------- Adaptive routing helpers (internal/pure) ----------

function deriveTaskTypeKey(req: AnalysisRequest): string {
  // Prefer explicit analysisType; otherwise fall back to detector/category if present.
  const explicit = (req as any)?.analysisType;
  if (explicit && typeof explicit === 'string') return explicit;
  const detector = (req as any)?.detector ?? (req as any)?.category;
  return typeof detector === 'string' ? detector : 'general';
}

function isComplex(req: AnalysisRequest): boolean {
  if ((req as any)?.flags?.complex === true) return true;
  const prevCount = Array.isArray(req.previousScenes) ? req.previousScenes.length : 0;
  const totalChars =
    (req.scene?.text?.length ?? 0) +
    (req.previousScenes ?? []).reduce((a, s) => a + (s.text?.length ?? 0), 0);
  // Conservative thresholds
  if (req.analysisType === 'complex' || req.analysisType === 'full') return true;
  return prevCount >= 6 || totalChars > 12_000;
}

function confidenceThreshold(taskTypeKey: string, complex: boolean): number {
  if (complex) return 0.75;
  if (taskTypeKey === 'simple') return 0.65;
  return 0.7;
}

/**
 * Internal pure selector:
 * - chooses base tier via heuristics (fast for simple, strong for complex)
 * - considers adjacent tiers
 * - scores via tracker with epsilon-greedy exploration
 */
function selectModel(
  req: AnalysisRequest,
  candidates: RegistryModel[],
  tracker: ModelPerformanceTracker
): string {
  const taskKey = deriveTaskTypeKey(req);
  const complex = isComplex(req);
  const tiers: Tier[] = complex ? ['strong', 'balanced'] : ['fast', 'balanced'];
 
  const pool = candidates.filter((c) => tiers.includes(c.tier));
  if (pool.length === 0) return candidates[0]?.id ?? 'gpt-5';

  const latencyWeight = complex ? 0.2 : 0.4;
  const accuracyWeight = complex ? 0.8 : 0.6;

  const scored = pool.map((m) => {
    const normCost = (m.relativeCost - 1) / 2; // 1 -> 0, 2 -> 0.5, 3 -> 1
    const costWeight = complex ? normCost * 0.5 : normCost; // penalize cost less for complex
    const s = tracker.score(m.id, taskKey, {
      costWeight,
      latencyWeight,
      accuracyWeight,
    });
    return { id: m.id, score: s };
  });

  // epsilon-greedy exploration
  const epsilon = 0.1;
  if (Math.random() < epsilon) {
    const r = Math.floor(Math.random() * scored.length);
    return scored[r].id;
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

export default AIServiceManager;