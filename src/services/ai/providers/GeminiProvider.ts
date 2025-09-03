import BaseProvider from './BaseProvider';
import {
  AnalysisRequest,
  AnalysisResponse,
  GeminiConfig,
  ProviderError,
  ProviderName,
  ValidationError,
} from '../types';
import { validateAndNormalize } from '../utils/ResponseValidator';

function buildGeminiUrl(model: string, apiKey: string, baseUrl?: string): string {
  if (baseUrl && baseUrl.trim().length > 0) {
    // Expect caller to include model + api key if they override baseUrl
    return baseUrl;
  }
  const encodedModel = encodeURIComponent(model);
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
}

function costTierForModel(model: string | undefined): 'low' | 'medium' | 'high' {
  const m = (model ?? '').toLowerCase();
  if (m.includes('pro')) return 'low';
  if (m.includes('flash') || m.includes('lite')) return 'low';
  return 'medium';
}

/**
 * Google Gemini provider implementation using generateContent API.
 */
export class GeminiProvider extends BaseProvider<GeminiConfig> {
  constructor(config: GeminiConfig, breaker: import('../utils/CircuitBreaker').default) {
    super('google' as ProviderName, config, breaker);
  }

  /**
   * Execute continuity analysis via Gemini generateContent.
   */
  public async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    if (!this.config.apiKey) {
      throw new ProviderError('google', 'Missing Google API key in configuration');
    }

    const modelLabel = this.config.model ?? 'gemini-2-5-pro';
    const url = buildGeminiUrl(modelLabel, this.config.apiKey, this.config.baseUrl);

    const prompt = this.formatPrompt(req);

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };

    const headers: HeadersInit = {
      'content-type': 'application/json',
    };

    const started = Date.now();
    try {
      const res = await this.fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const raw = (await res.json()) as unknown;
      const normalized = validateAndNormalize('google', raw, modelLabel);

      const durationMs = Date.now() - started;
      const costEstimate = this.estimateCost(req, costTierForModel(modelLabel));
      const confidence = normalized.metadata.confidence ?? 0.5;

      const out: AnalysisResponse = {
        issues: normalized.issues,
        metadata: {
          modelUsed: modelLabel,
          provider: 'google',
          costEstimate,
          durationMs,
          confidence,
          cached: false,
        },
      };

      return out;
    } catch (err) {
      // TODO: Replace with production logger
      console.log('[GeminiProvider] analyze error:', err);
      if (err instanceof ValidationError) {
        throw err;
      }
      if (err && typeof err === 'object' && (err as Error).name === 'CircuitBreakerOpenError') {
        throw err;
      }
      throw new ProviderError('google', 'Gemini analyze failed', { cause: err });
    }
  }
}

export default GeminiProvider;