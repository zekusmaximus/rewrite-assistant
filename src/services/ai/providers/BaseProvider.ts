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
   * Create a deterministic prompt that instructs the model to emit JSON only.
   */
  protected formatPrompt(req: AnalysisRequest): string {
    const sceneSummary = {
      id: req.scene.id,
      text: req.scene.text,
      wordCount: req.scene.wordCount,
      position: req.scene.position,
      originalPosition: req.scene.originalPosition,
      characters: req.scene.characters,
      timeMarkers: req.scene.timeMarkers,
      locationMarkers: req.scene.locationMarkers,
      hasBeenMoved: req.scene.hasBeenMoved,
      rewriteStatus: req.scene.rewriteStatus,
    };

    const prevIds = req.previousScenes.map((s) => s.id);
    const reader = {
      knownCharacters: Array.from(req.readerContext.knownCharacters).sort(),
      establishedTimeline: req.readerContext.establishedTimeline.map((t) => ({
        label: t.label,
        when: t.when ?? null,
      })),
      revealedPlotPoints: [...req.readerContext.revealedPlotPoints],
      establishedSettings: req.readerContext.establishedSettings.map((l) => ({
        name: l.name,
        id: l.id ?? null,
      })),
    };

    const instruction =
      'You are a continuity analyst for fiction manuscripts. Analyze the current scene for continuity ' +
      'issues considering the prior scenes and what a reader already knows. Only output strict JSON that matches ' +
      'the specified schema. Do not include markdown fences or commentary.';

    const schemaHint =
      'Expected JSON shape: {"issues":[{"type":"pronoun|timeline|character|plot|context|engagement","severity":"must-fix|should-fix|consider","description":"string","textSpan":[start,end],"suggestedFix":"string?"}]}';

    return [
      instruction,
      `AnalysisType: ${req.analysisType}`,
      `PreviousSceneIDs: ${JSON.stringify(prevIds)}`,
      `ReaderContext: ${JSON.stringify(reader)}`,
      `Scene: ${JSON.stringify(sceneSummary)}`,
      schemaHint,
      'Respond with ONLY the JSON.',
    ].join('\n');
  }

  /**
   * Naive cost estimate based on character count and tier multiplier.
   */
  protected estimateCost(req: AnalysisRequest, costTier: 'low' | 'medium' | 'high'): number {
    const charCount =
      (req.scene.text?.length ?? 0) +
      req.previousScenes.reduce((acc, s) => acc + (s.text?.length ?? 0), 0);
    const tokens = Math.ceil(charCount / 4); // rough token estimate
    const mult = costTier === 'high' ? 0.004 : costTier === 'medium' ? 0.002 : 0.001; // arbitrary unit cost
    return Number((tokens * mult).toFixed(4));
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