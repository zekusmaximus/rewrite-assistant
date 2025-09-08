import BaseProvider from './BaseProvider';
import {
  AnalysisRequest,
  AnalysisResponse,
  OpenAIConfig,
  ProviderError,
  ProviderName,
  ValidationError,
} from '../types';
import { validateAndNormalize } from '../utils/ResponseValidator';
import { buildOpenAIPrompt, getOpenAIResponseFormat } from '../prompts/OpenAIPrompts';
import { estimateMessageTokens, estimateTokensForModel } from '../utils/Tokenizers';
import { estimateCost as estimateUsdCost } from '../optimization/Pricing';

function costTierForModel(model: string | undefined): 'low' | 'medium' | 'high' {
  const m = (model ?? '').toLowerCase();
  if (m.includes('gpt-5')) return 'low';
  if (m.includes('o1') || m.includes('o3') || m.includes('gpt-4')) return 'high';
  return 'medium';
}

/**
 * OpenAI Chat Completions provider implementation.
 */
export class OpenAIProvider extends BaseProvider<OpenAIConfig> {
  constructor(config: OpenAIConfig, breaker: import('../utils/CircuitBreaker').default) {
    super('openai' as ProviderName, config, breaker);
  }

  /**
   * Build OpenAI-specific structured messages using templates.
   */
  protected formatPrompt(req: AnalysisRequest): { system: string; user: string } {
    const readerContext = req.readerContext;
    const previousScenes = req.previousScenes;
    const newPosition = req.scene.position;
    const sceneText = req.scene.text;
    // Optional, mapped locally without type changes
    const genreStyle = (req as any).genreStyle ?? (req.scene as any)?.genreStyle ?? undefined;

    return buildOpenAIPrompt({
      readerContext,
      previousScenes,
      newPosition,
      sceneText,
      genreStyle,
    });
  }

  /**
   * Execute continuity analysis via OpenAI chat.completions.
   */
  public async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    if (!this.config.apiKey) {
      throw new ProviderError('openai', 'Missing OpenAI API key in configuration');
    }

    const modelLabel = this.config.model ?? 'gpt-5';
    const url = this.config.baseUrl?.trim() || 'https://api.openai.com/v1/chat/completions';

    // Enforce optional budgets (soft trimming oldest previousScenes)
    const budgeted = this.enforceInputBudget(req, modelLabel);
    const effReq = budgeted.req;

    const { system, user } = this.formatPrompt(effReq) as { system: string; user: string };

    const body = {
      model: modelLabel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      response_format: getOpenAIResponseFormat(),
      // We avoid streaming to keep simpler validation path
    };

    // Pre-flight input token estimate from actual payload
    let inputTokensEstimate = estimateMessageTokens(modelLabel, body.messages as Array<{ role?: string; content: string }>);

    const headers: HeadersInit = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.config.apiKey}`,
    };

    const started = Date.now();
    try {
      const res = await this.fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const raw = (await res.json()) as any;
      const normalized = validateAndNormalize('openai', raw, modelLabel);

      // Prefer provider-reported usage when present
      if (raw && raw.usage && Number.isFinite(raw.usage.prompt_tokens)) {
        inputTokensEstimate = Math.max(0, Number(raw.usage.prompt_tokens));
      }

      // Estimate output tokens from model content if usage missing
      let outputText = '';
      try {
        outputText = raw?.choices?.[0]?.message?.content ?? '';
      } catch {}
      let outputTokensEstimate =
        raw && raw.usage && Number.isFinite(raw.usage.completion_tokens)
          ? Math.max(0, Number(raw.usage.completion_tokens))
          : estimateTokensForModel(modelLabel, String(outputText ?? ''));

      const durationMs = Date.now() - started;

      const costEstimate = this.estimateCostFromUsage(modelLabel, {
        inputTokens: inputTokensEstimate,
        outputTokens: outputTokensEstimate,
      });

      const breakdown = estimateUsdCost(modelLabel, {
        inputTokens: inputTokensEstimate,
        outputTokens: outputTokensEstimate,
      }).breakdown;

      const confidence = normalized.metadata.confidence ?? 0.5;

      // Build metadata with optional local fields via widening cast to avoid breaking public types
      const meta: any = {
        modelUsed: modelLabel,
        provider: 'openai',
        costEstimate,
        durationMs,
        confidence,
        cached: false,
      };
      if (budgeted.meta) {
        meta.trimmed = true;
        meta.trimDetails = budgeted.meta;
      }
      meta.tokensInputEstimated = inputTokensEstimate;
      meta.tokensOutputEstimated = outputTokensEstimate;
      meta.costBreakdownUSD = breakdown;

      const out: AnalysisResponse = {
        issues: normalized.issues,
        // Cast to satisfy AnalysisResponse without altering public type
        metadata: meta as AnalysisResponse['metadata'],
      };

      return out;
    } catch (err) {
      // TODO: Replace with production logger
      console.log('[OpenAIProvider] analyze error:', err);
      if (err instanceof ValidationError) {
        throw err;
      }
      if (err && typeof err === 'object' && (err as Error).name === 'CircuitBreakerOpenError') {
        throw err;
      }
      throw new ProviderError('openai', 'OpenAI analyze failed', { cause: err });
    }
  }
}

export default OpenAIProvider;