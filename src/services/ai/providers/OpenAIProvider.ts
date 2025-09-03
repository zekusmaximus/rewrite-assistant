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
   * Execute continuity analysis via OpenAI chat.completions.
   */
  public async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    if (!this.config.apiKey) {
      throw new ProviderError('openai', 'Missing OpenAI API key in configuration');
    }

    const modelLabel = this.config.model ?? 'gpt-5';
    const url = this.config.baseUrl?.trim() || 'https://api.openai.com/v1/chat/completions';

    const prompt = this.formatPrompt(req);

    const body = {
      model: modelLabel,
      messages: [
        {
          role: 'system',
          content:
            'You are a meticulous continuity analyst. Respond with ONLY valid JSON per the requested schema. No extra text.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' as const },
      // We avoid streaming to keep simpler validation path
    };

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

      const raw = (await res.json()) as unknown;
      const normalized = validateAndNormalize('openai', raw, modelLabel);

      const durationMs = Date.now() - started;
      const costEstimate = this.estimateCost(req, costTierForModel(modelLabel));
      const confidence = normalized.metadata.confidence ?? 0.5;

      const out: AnalysisResponse = {
        issues: normalized.issues,
        metadata: {
          modelUsed: modelLabel,
          provider: 'openai',
          costEstimate,
          durationMs,
          confidence,
          cached: false,
        },
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