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

const ANTHROPIC_VERSION = '2023-06-01';

function costTierForModel(model: string | undefined): 'low' | 'medium' | 'high' {
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

    const prompt = this.formatPrompt(req);

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

      const raw = (await res.json()) as unknown;
      const normalized = validateAndNormalize('anthropic', raw, modelLabel);

      const durationMs = Date.now() - started;
      const costEstimate = this.estimateCost(req, costTierForModel(modelLabel));
      const confidence = normalized.metadata.confidence ?? 0.5;

      const out: AnalysisResponse = {
        issues: normalized.issues,
        metadata: {
          modelUsed: modelLabel,
          provider: 'anthropic',
          costEstimate,
          durationMs,
          confidence,
          cached: false,
        },
      };

      return out;
    } catch (err) {
      // TODO: Replace with production logger
      console.log('[ClaudeProvider] analyze error:', err);
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