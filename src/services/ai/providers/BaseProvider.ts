import {
  AnalysisRequest,
  AnalysisResponse,
  BaseProviderConfig,
  ProviderError,
  ProviderName,
  RateLimitError,
  TimeoutError,
} from '../types';
import CircuitBreaker, { backoffSchedule } from '../utils/CircuitBreaker';
import { estimateTokensForModel } from '../utils/Tokenizers';
import { estimateCost as estimateUsdCost } from '../optimization/Pricing';
/**
 * Abstract base class for AI providers.
 * Handles:
 * - Circuit breaker integration
 * - Exponential backoff retries
 * - Timeouts using AbortController
 * - Standardized error translation
 */
export abstract class BaseProvider<C extends BaseProviderConfig> {
  protected readonly name: ProviderName;
  protected readonly config: C;
  protected readonly breaker: CircuitBreaker;

  // Session-scoped token accounting (soft, in-memory)
  private __sessionInputTokens = 0;
  private __sessionOutputTokens = 0;

  constructor(name: ProviderName, config: C, breaker: CircuitBreaker) {
    this.name = name;
    this.config = config;
    this.breaker = breaker;
  }

  /**
   * Perform continuity analysis with the provider.
   */
  public abstract analyze(req: AnalysisRequest): Promise<AnalysisResponse>;

  /**
   * Orchestrate fetch with retries, backoff, circuit breaker, and timeouts.
   * Ensures each function is focused and short.
   */
  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 5
  ): Promise<Response> {
    const attempts = Math.max(1, Math.min(maxRetries, backoffSchedule().length + 1));
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.attemptOnce(url, init);
      } catch (err) {
        if (this.isCircuitOpen(err)) throw err;
        if (!this.shouldRetry(err) || attempt === attempts - 1) throw err;
        await this.delay(this.getBackoffDelay(attempt));
      }
    }
    // Unreachable: loop either returns or throws
    throw new ProviderError(this.name, 'Unknown retry orchestration error');
  }

  /**
   * Single attempt guarded by circuit breaker with precise error classification.
   */
  private async attemptOnce(url: string, init: RequestInit): Promise<Response> {
    this.breaker.beforeCall(this.name);
    try {
      const res = await this.timedFetch(url, init, this.timeoutMs());
      if (res.status === 429) {
        const rl = new RateLimitError(this.name, '429 Too Many Requests');
        this.breaker.onFailure(this.name, rl);
        throw rl;
      }
      if (!res.ok) {
        const body = await this.safeText(res);
        const retriable = res.status >= 500 || res.status === 408;
        const perr = new ProviderError(
          this.name,
          `HTTP ${res.status} ${res.statusText} from ${this.name}: ${body.slice(0, 500)}`,
          { status: res.status, retriable }
        );
        this.breaker.onFailure(this.name, perr);
        throw perr;
      }
      this.breaker.onSuccess(this.name);
      return res;
    } catch (e) {
      if (e instanceof TimeoutError) {
        this.breaker.onFailure(this.name, e);
      }
      // CircuitBreakerOpenError is thrown before reaching here; allow it to bubble
      if (this.isCircuitOpen(e)) throw e;
      // For other network errors, wrap if last resort handled by orchestrator
      if (!(e instanceof ProviderError) && !(e instanceof RateLimitError) && !(e instanceof TimeoutError)) {
        const pErr = new ProviderError(this.name, `Network error calling ${this.name}`, {
          cause: e,
          retriable: true,
        });
        this.breaker.onFailure(this.name, pErr);
        throw pErr;
      }
      throw e;
    }
  }

  private shouldRetry(err: unknown): boolean {
    if (err instanceof TimeoutError) return true;
    if (err instanceof RateLimitError) return true;
    if (err instanceof ProviderError) return err.isRetriable === true;
    return false;
  }

  private isCircuitOpen(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && (err as Error).name === 'CircuitBreakerOpenError');
  }

  private getBackoffDelay(attempt: number): number {
    const sched = backoffSchedule();
    const idx = Math.min(attempt, sched.length - 1);
    return sched[idx] ?? 1000;
  }

  /**
   * Providers must build their own prompt payloads appropriate for their APIs.
   * This base class no longer constructs a generic prompt.
   */
  protected abstract formatPrompt(req: AnalysisRequest): unknown;

  /**
   * Backward-compatible estimateCost used by existing providers.
   * Reimplemented to use token-based pricing with heuristics.
   * Note: Output tokens are not known here; this returns input-only estimate.
   */
  protected estimateCost(req: AnalysisRequest, _costTier: 'low' | 'medium' | 'high'): number {
    const modelId = this.config.model ?? '';
    const inputTokens = this.estimateInputTokensForRequest(modelId, req);
    const { estimatedUSD } = estimateUsdCost(modelId || 'unknown', { inputTokens, outputTokens: 0 });
    // Round to 6 decimals to be stable
    return Math.round(estimatedUSD * 1e6) / 1e6;
  }

  /**
   * Preferred cost estimator when token usage is available (or computed by caller).
   */
  protected estimateCostFromUsage(
    modelId: string,
    usage: { inputTokens: number; outputTokens?: number }
  ): number {
    const { estimatedUSD } = estimateUsdCost(modelId || 'unknown', usage);
    return Math.round(estimatedUSD * 1e6) / 1e6;
  }

  /**
   * Estimate input tokens for a request based on scene text and previous scenes.
   * Deterministic, heuristic if tokenizer not available.
   */
  protected estimateInputTokensForRequest(modelId: string, req: AnalysisRequest): number {
    const sceneText = req.scene?.text ?? '';
    const prevTexts = (req.previousScenes ?? []).map((s) => s?.text ?? '');
    let total = estimateTokensForModel(modelId, sceneText);
    for (const t of prevTexts) total += estimateTokensForModel(modelId, t);
    // small fixed overhead for separators/roles
    total += 8;
    return Math.max(1, total | 0);
  }

  /**
   * Enforce optional input token budgets by trimming oldest previousScenes first.
   * Returns possibly-trimmed request and trimming metadata. Defaults to no-op when budgets undefined.
   * If HARD_FAIL_ON_BUDGET === 'true', throws ProviderError when input exceeds budget after best-effort trimming.
   */
  protected enforceInputBudget(
    req: AnalysisRequest,
    modelId?: string
  ): { req: AnalysisRequest; meta?: { trimmed: true; trimmedCount: number; beforeTokens: number; afterTokens: number; budget: number } } {
    const budgets = this.readBudgetsFromEnv();
    const inBudget = budgets.maxInputTokensPerRequest;
    if (!inBudget || inBudget <= 0) {
      return { req };
    }

    // Compute current input tokens
    const model = modelId ?? this.config.model ?? '';
    const beforeTokens = this.estimateInputTokensForRequest(model, req);

    if (beforeTokens <= inBudget) {
      return { req };
    }

    // Trim previousScenes from oldest to newest until within budget, preserving full scene text
    const clone: AnalysisRequest = {
      ...req,
      previousScenes: [...(req.previousScenes ?? [])],
    };

    let trimmedCount = 0;
    while (clone.previousScenes.length > 0) {
      clone.previousScenes.shift();
      trimmedCount++;
      const est = this.estimateInputTokensForRequest(model, clone);
      if (est <= inBudget) {
        const afterTokens = est;
        // Update session accounting (soft)
        this.__sessionInputTokens += afterTokens;
        return {
          req: clone,
          meta: { trimmed: true, trimmedCount, beforeTokens, afterTokens, budget: inBudget },
        };
      }
    }

    // Could not fit under budget even after removing all previousScenes
    const afterTokens = this.estimateInputTokensForRequest(model, {
      ...clone,
      previousScenes: [],
    });
    const hardFail = (process.env?.HARD_FAIL_ON_BUDGET ?? '').toLowerCase() === 'true';
    if (hardFail && afterTokens > inBudget) {
      throw new ProviderError(this.name, `Input token budget exceeded (after=${afterTokens}, budget=${inBudget})`, {
        retriable: false,
      });
    }
    this.__sessionInputTokens += afterTokens;
    return {
      req: { ...clone, previousScenes: [] },
      meta: { trimmed: true, trimmedCount, beforeTokens, afterTokens, budget: inBudget },
    };
  }

  /**
   * Read optional budgets from environment. Undefined/NaN -> undefined.
   */
  private readBudgetsFromEnv(): {
    maxInputTokensPerRequest?: number;
    maxOutputTokensPerRequest?: number;
    maxTokensPerSession?: number;
  } {
    const parseNum = (v: any): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
    };
    return {
      maxInputTokensPerRequest: parseNum(process.env?.MAX_INPUT_TOKENS_PER_REQUEST),
      maxOutputTokensPerRequest: parseNum(process.env?.MAX_OUTPUT_TOKENS_PER_REQUEST),
      maxTokensPerSession: parseNum(process.env?.MAX_TOKENS_PER_SESSION),
    };
  }

  // Internals

  private timeoutMs(): number {
    return this.config.timeoutMs ?? 30_000;
  }

  private async timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      return res;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw new TimeoutError(this.name, timeoutMs);
      }
      throw e;
    } finally {
      clearTimeout(id);
    }
  }

  private async safeText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '';
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }
}

export default BaseProvider;