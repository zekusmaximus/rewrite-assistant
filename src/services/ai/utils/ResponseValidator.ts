import { z } from 'zod';
import {
  AnalysisResponse,
  ProviderName,
  ValidationError,
} from '../types';

// ------------ Raw provider schemas ------------

/**
 * OpenAI chat.completions schema where the JSON is in choices[0].message.content
 */
export function openAIChatSchema() {
  return z.object({
    id: z.string().optional(),
    object: z.string().optional(),
    choices: z
      .array(
        z.object({
          index: z.number().optional(),
          message: z.object({
            role: z.string().optional(),
            content: z.string(),
          }),
          finish_reason: z.string().optional(),
        })
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .optional(),
  });
}

/**
 * Anthropic Messages API schema where JSON is in content[0].text
 */
export function anthropicSchema() {
  return z.object({
    id: z.string().optional(),
    type: z.string().optional(),
    role: z.string().optional(),
    model: z.string().optional(),
    content: z
      .array(
        z.object({
          type: z.string().optional(),
          text: z.string(),
        })
      )
      .min(1),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .optional(),
  });
}

/**
 * Google Gemini generateContent schema where JSON is in candidates[0].content.parts[].text
 */
export function geminiSchema() {
  return z.object({
    candidates: z
      .array(
        z.object({
          content: z.object({
            role: z.string().optional(),
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                })
              )
              .min(1),
          }),
          finishReason: z.string().optional(),
        })
      )
      .min(1),
    promptFeedback: z.unknown().optional(),
  });
}

// ------------ Normalized response schema (internal) ------------

const continuityIssueSchema = z.object({
  type: z.enum(['pronoun', 'timeline', 'character', 'plot', 'context', 'engagement']),
  severity: z.enum(['must-fix', 'should-fix', 'consider']),
  description: z.string(),
  textSpan: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .refine(([a, b]: [number, number]) => a <= b, { message: 'textSpan start must be <= end' }),
  suggestedFix: z.string().optional(),
});

/**
 * Schema for normalized output. Allows partial metadata during parsing; defaults are applied later.
 */
export function normalizedResponseSchema() {
  return z.object({
    issues: z.array(continuityIssueSchema).default([]),
    metadata: z
      .object({
        modelUsed: z.string().optional(),
        provider: z.enum(['anthropic', 'openai', 'google']).optional(),
        costEstimate: z.number().optional(),
        durationMs: z.number().optional(),
        confidence: z.number().min(0).max(1).optional(),
        cached: z.boolean().optional(),
      })
      .optional(),
  });
}

// ------------ Utilities ------------

/**
 * Extract the first JSON object from arbitrary text using bracket counting.
 * Handles nested braces and ignores braces inside strings.
 */
export function extractJsonFromText(text: string): string {
  let start = -1;
  let depth = 0;
  let inString: false | '"' | "'" = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === inString) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch as '"' | "'";
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  // Fallback: trim and try if entire string looks like JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  throw new Error('No JSON object found in text');
}

// ------------ Main normalization ------------

function extractTextPayload(provider: ProviderName, raw: unknown): string {
  try {
    if (provider === 'openai') {
      const parsed = openAIChatSchema().parse(raw);
      return parsed.choices[0].message.content;
    }
    if (provider === 'anthropic') {
      const parsed = anthropicSchema().parse(raw);
      return parsed.content[0].text;
    }
    // google
    const parsed = geminiSchema().parse(raw);
    const parts = parsed.candidates[0]?.content?.parts ?? [];
    const firstWithText = parts.find((p: { text?: string }) => typeof p.text === 'string' && (p.text?.length ?? 0) > 0);
    if (!firstWithText || !firstWithText.text) {
      throw new Error('No text part found in Gemini response');
    }
    return firstWithText.text;
  } catch (e) {
    // Surface schema mismatch for debugging
    console.warn(`[ResponseValidator] ${provider} schema mismatch:`, e);
    throw e;
  }
}

function coerceToAnalysisResponse(
  provider: ProviderName,
  modelLabel: string,
  candidate: unknown
): AnalysisResponse {
  const parsed = normalizedResponseSchema().parse(candidate);

  const confidence =
    (parsed.metadata && typeof parsed.metadata.confidence === 'number'
      ? parsed.metadata.confidence
      : undefined) ?? 0.5;

  // Fill required metadata with defaults; cost/duration/cached are filled by providers/manager later
  const normalized: AnalysisResponse = {
    issues: parsed.issues,
    metadata: {
      modelUsed: modelLabel,
      provider,
      costEstimate: 0,
      durationMs: 0,
      confidence,
      cached: false,
    },
  };
  return normalized;
}

/**
 * Validate provider raw response and normalize to AnalysisResponse.
 * - Applies provider-specific schema
 * - Extracts embedded JSON via robust extraction
 * - Validates normalized payload and applies safe defaults
 * - Throws ValidationError on failure
 */
export function validateAndNormalize(
  provider: ProviderName,
  raw: unknown,
  fallbackModelLabel: string
): AnalysisResponse {
  try {
    const payloadText = extractTextPayload(provider, raw);
    const jsonStr = extractJsonFromText(payloadText);
    const candidate = JSON.parse(jsonStr) as unknown;
    return coerceToAnalysisResponse(provider, fallbackModelLabel, candidate);
  } catch (err) {
    console.warn(
      `[ResponseValidator] Failed to validate/normalize ${provider} response for model "${fallbackModelLabel}":`,
      err
    );
    throw new ValidationError(provider, 'Response validation failed');
  }
}