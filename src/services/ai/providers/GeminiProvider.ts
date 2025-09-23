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
import { buildGeminiPrompt } from '../prompts/GeminiPrompts';
import { estimateMessageTokens, estimateTokensForModel } from '../utils/Tokenizers';
import { estimateCost as estimateUsdCost } from '../optimization/Pricing';

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


/**
 * Google Gemini provider implementation using generateContent API.
 */
export class GeminiProvider extends BaseProvider<GeminiConfig> {
  constructor(config: GeminiConfig, breaker: import('../utils/CircuitBreaker').default) {
    super('google' as ProviderName, config, breaker);
  }

  /**
   * Build Gemini-specific content structure with instruction and parts.
   */
  protected formatPrompt(req: AnalysisRequest): { instruction: string; parts: Array<{ text: string }> } {
    const readerContext = req.readerContext;
    const previousScenes = req.previousScenes;
    const newPosition = req.scene.position;
    const sceneText = req.scene.text;
    const genreStyle = (req as any).genreStyle ?? (req.scene as any)?.genreStyle ?? undefined;

    return buildGeminiPrompt({
      readerContext,
      previousScenes,
      newPosition,
      sceneText,
      genreStyle,
    });
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

    // Enforce optional input budgets (trim oldest previousScenes)
    const budgeted = this.enforceInputBudget(req, modelLabel);
    const effReq = budgeted.req;

    const { instruction, parts } = this.formatPrompt(effReq) as { instruction: string; parts: Array<{ text: string }> };

    const body = {
      systemInstruction: {
        role: 'system',
        parts: [{ text: instruction }],
      },
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: {
        temperature: 0.2,
        // Prefer JSON-only responses if supported by the API
        response_mime_type: 'application/json',
      },
    };

    // Pre-flight estimate of input tokens using simplified message view
    let inputTokensEstimate = estimateMessageTokens(modelLabel, [
      { role: 'system', content: instruction },
      { role: 'user', content: parts.map((p) => p.text ?? '').join('\n') },
    ]);

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

      const raw = (await res.json()) as any;
      const normalized = validateAndNormalize('google', raw, modelLabel);

      // Gemini v1beta responses may not include token usage in public API.
      // If present in future, prefer it; else heuristic on text length.
      // Attempt to extract output text
      let outputText = '';
      try {
        const firstCandidate = raw?.candidates?.[0];
        const partsOut = firstCandidate?.content?.parts ?? [];
        const withText = partsOut.find((p: { text?: string }) => typeof p.text === 'string' && ((p.text?.length ?? 0) > 0));
        outputText = withText?.text ?? '';
      } catch { void 0; }

      // Token usage fields if they appear in future:
      const usageIn = Number(raw?.usageMetadata?.promptTokenCount);
      const usageOut = Number(raw?.usageMetadata?.candidatesTokenCount);
      if (Number.isFinite(usageIn)) inputTokensEstimate = Math.max(0, usageIn);

      const outputTokensEstimate = Number.isFinite(usageOut)
        ? Math.max(0, usageOut)
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
        provider: 'google',
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