import BaseProvider from './BaseProvider';
import {
  AnalysisRequest,
  AnalysisResponse,
  ClaudeConfig,
  ProviderError,
  ProviderName,
  ValidationError,
} from '../types';
import { validateAndNormalize } from '../utils/ResponseValidator';
import { buildClaudePrompt } from '../prompts/ClaudePrompts';
import { estimateMessageTokens, estimateTokensForModel } from '../utils/Tokenizers';
import { estimateCost as estimateUsdCost } from '../optimization/Pricing';
import { redactObjectSecrets } from '../../../shared/security';

const ANTHROPIC_VERSION = '2023-06-01';

function _costTierForModel(model: string | undefined): 'low' | 'medium' | 'high' {
  const m = (model ?? '').toLowerCase();
  if (m.includes('opus') || m.includes('o')) return 'high';
  if (m.includes('sonnet') || m.includes('haiku') || m.includes('sonnet-4')) return 'medium';
  return 'medium';
}

/**
 * Claude (Anthropic) provider implementation using Messages API.
 */
export class ClaudeProvider extends BaseProvider<ClaudeConfig> {
  constructor(config: ClaudeConfig, breaker: import('../utils/CircuitBreaker').default) {
    super('anthropic' as ProviderName, config, breaker);
  }

  /**
   * Build Anthropic-specific prompt payload using XML-style template.
   */
  protected formatPrompt(req: AnalysisRequest): string {
    const readerContext = req.readerContext;
    const previousScenes = req.previousScenes;
    const newPosition = req.scene.position;
    const sceneText = req.scene.text;
    return buildClaudePrompt(readerContext, previousScenes, newPosition, sceneText);
  }

  /**
   * Execute continuity analysis via Anthropic Messages API.
   */
  public async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    if (!this.config.apiKey) {
      throw new ProviderError('anthropic', 'Missing Anthropic API key in configuration');
    }

    const modelLabel = this.config.model ?? 'claude-sonnet-4';
    const url =
      this.config.baseUrl?.trim() ||
      'https://api.anthropic.com/v1/messages';

    // Enforce optional budgets by trimming older previousScenes
    const budgeted = this.enforceInputBudget(req, modelLabel);
    const effReq = budgeted.req;

    const prompt = this.formatPrompt(effReq) as string;

    const body = {
      model: modelLabel,
      system:
        'You are a meticulous continuity analyst. Respond with ONLY valid JSON per the requested schema. No extra text.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    };

    // Pre-flight estimate of input tokens using simplified message view
    let inputTokensEstimate = estimateMessageTokens(modelLabel, [
      { role: 'system', content: body.system },
      { role: 'user', content: prompt },
    ]);

    const headers: HeadersInit = {
      'content-type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };

    const started = Date.now();
    try {
      const res = await this.fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const raw = (await res.json()) as any;
      const normalized = validateAndNormalize('anthropic', raw, modelLabel);

      // Prefer provider usage when available
      if (raw && raw.usage && Number.isFinite(raw.usage.input_tokens)) {
        inputTokensEstimate = Math.max(0, Number(raw.usage.input_tokens));
      }

      // Output tokens: prefer usage, else estimate from first content text
      let outputText = '';
      try {
        outputText = raw?.content?.[0]?.text ?? '';
      } catch {
        // Intentionally no-op: best-effort extraction; fall back to usage or token estimation if absent.
      }
      let outputTokensEstimate =
        raw && raw.usage && Number.isFinite(raw.usage.output_tokens)
          ? Math.max(0, Number(raw.usage.output_tokens))
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

      const meta: any = {
        modelUsed: modelLabel,
        provider: 'anthropic',
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
        metadata: meta as AnalysisResponse['metadata'],
      };

      return out;
    } catch (err) {
      // TODO: Replace with production logger
      console.log('[ClaudeProvider] analyze error:', redactObjectSecrets(err));
      if (err instanceof ValidationError) {
        throw err;
      }
      if (err && typeof err === 'object' && (err as Error).name === 'CircuitBreakerOpenError') {
        throw err;
      }
      throw new ProviderError('anthropic', 'Claude analyze failed', { cause: err });
    }
  }
}

export default ClaudeProvider;