import { AnalysisResponse, ProviderName, ValidationError } from '../types';
import type { ContinuityIssue } from '../../../shared/types';

/**
 * Minimal parser interface compatible with previous .parse(...) usage.
 * Each schema function returns an object with a parse method that throws on invalid input.
 */
type Parser<T> = {
  parse(value: unknown): T;
};

// ------------ Internal helpers and type guards ------------

const ISSUE_TYPES = ['pronoun', 'timeline', 'character', 'plot', 'context', 'engagement'] as const;
const ISSUE_SEVERITIES = ['must-fix', 'should-fix', 'consider'] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}
function isNumberFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isIntegerNonNegative(v: unknown): v is number {
  return isNumberFinite(v) && Number.isInteger(v) && v >= 0;
}
function isProviderName(v: unknown): v is ProviderName {
  return v === 'anthropic' || v === 'openai' || v === 'google';
}

function isTextSpan(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    isIntegerNonNegative(v[0]) &&
    isIntegerNonNegative(v[1]) &&
    v[0] <= v[1]
  );
}

/**
 * Runtime guard for ContinuityIssue.
 */
function isContinuityIssue(v: unknown): v is ContinuityIssue {
  if (!isObject(v)) return false;
  const type = (v as Record<string, unknown>).type;
  const severity = (v as Record<string, unknown>).severity;
  const description = (v as Record<string, unknown>).description;
  const textSpan = (v as Record<string, unknown>).textSpan;
  const suggestedFix = (v as Record<string, unknown>).suggestedFix;

  if (!(isString(type) && (ISSUE_TYPES as readonly string[]).includes(type))) return false;
  if (!(isString(severity) && (ISSUE_SEVERITIES as readonly string[]).includes(severity))) return false;
  if (!isString(description)) return false;
  if (!isTextSpan(textSpan)) return false;
  if (suggestedFix !== undefined && !isString(suggestedFix)) return false;

  return true;
}

/**
 * Validates and narrows the optional metadata block for normalized responses.
 * Returns undefined if input is undefined. Throws detailed Error on invalid inputs.
 */
function validateNormalizedMetadata(
  meta: unknown
):
  | {
      modelUsed?: string;
      provider?: ProviderName;
      costEstimate?: number;
      durationMs?: number;
      confidence?: number;
      cached?: boolean;
    }
  | undefined {
  if (meta === undefined) return undefined;
  if (!isObject(meta)) throw new Error("Invalid normalized response: 'metadata' must be an object");

  const out: {
    modelUsed?: string;
    provider?: ProviderName;
    costEstimate?: number;
    durationMs?: number;
    confidence?: number;
    cached?: boolean;
  } = {};

  if ((meta as Record<string, unknown>).modelUsed !== undefined) {
    if (!isString((meta as Record<string, unknown>).modelUsed))
      throw new Error("Invalid normalized response: 'metadata.modelUsed' must be a string");
    out.modelUsed = (meta as Record<string, unknown>).modelUsed as string;
  }
  if ((meta as Record<string, unknown>).provider !== undefined) {
    if (!isProviderName((meta as Record<string, unknown>).provider))
      throw new Error(
        "Invalid normalized response: 'metadata.provider' must be 'anthropic' | 'openai' | 'google'"
      );
    out.provider = (meta as Record<string, unknown>).provider as ProviderName;
  }
  if ((meta as Record<string, unknown>).costEstimate !== undefined) {
    if (!isNumberFinite((meta as Record<string, unknown>).costEstimate))
      throw new Error("Invalid normalized response: 'metadata.costEstimate' must be a finite number");
    out.costEstimate = (meta as Record<string, unknown>).costEstimate as number;
  }
  if ((meta as Record<string, unknown>).durationMs !== undefined) {
    if (!isNumberFinite((meta as Record<string, unknown>).durationMs))
      throw new Error("Invalid normalized response: 'metadata.durationMs' must be a finite number");
    out.durationMs = (meta as Record<string, unknown>).durationMs as number;
  }
  if ((meta as Record<string, unknown>).confidence !== undefined) {
    const c = (meta as Record<string, unknown>).confidence;
    if (!isNumberFinite(c) || (c as number) < 0 || (c as number) > 1) {
      throw new Error("Invalid normalized response: 'metadata.confidence' must be a number in [0,1]");
    }
    out.confidence = c as number;
  }
  if ((meta as Record<string, unknown>).cached !== undefined) {
    if (!isBoolean((meta as Record<string, unknown>).cached))
      throw new Error("Invalid normalized response: 'metadata.cached' must be a boolean");
    out.cached = (meta as Record<string, unknown>).cached as boolean;
  }
  return out;
}

// ------------ Raw provider response shapes and guards ------------

interface OpenAIChatMessage {
  role?: string;
  content: string;
}
interface OpenAIChoice {
  index?: number;
  message: OpenAIChatMessage;
  finish_reason?: string;
}
interface OpenAIChatResponse {
  id?: string;
  object?: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function isOpenAIChatResponse(v: unknown): v is OpenAIChatResponse {
  if (!isObject(v)) return false;
  const choices = (v as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length < 1) return false;

  const first = choices[0];
  if (!isObject(first)) return false;
  const message = (first as Record<string, unknown>).message;
  if (!isObject(message)) return false;
  const content = (message as Record<string, unknown>).content;
  if (!isString(content)) return false;

  return true;
}

interface AnthropicContentItem {
  type?: string;
  text: string;
}
interface AnthropicResponse {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content: AnthropicContentItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function isAnthropicResponse(v: unknown): v is AnthropicResponse {
  if (!isObject(v)) return false;
  const content = (v as Record<string, unknown>).content;
  if (!Array.isArray(content) || content.length < 1) return false;
  const first = content[0];
  if (!isObject(first)) return false;
  const text = (first as Record<string, unknown>).text;
  if (!isString(text)) return false;
  return true;
}

interface GeminiPart {
  text?: string;
}
interface GeminiContent {
  role?: string;
  parts: GeminiPart[];
}
interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
}
interface GeminiResponse {
  candidates: GeminiCandidate[];
  promptFeedback?: unknown;
}

function isGeminiResponse(v: unknown): v is GeminiResponse {
  if (!isObject(v)) return false;
  const candidates = (v as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length < 1) return false;
  const first = candidates[0];
  if (!isObject(first)) return false;
  const content = (first as Record<string, unknown>).content;
  if (!isObject(content)) return false;
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts) || parts.length < 1) return false;
  // Not all parts must have text, but structure must exist
  return true;
}

// ------------ Raw provider "schema" factories (public API compatible) ------------

/**
 * OpenAI chat.completions "schema" returning a parser with .parse(raw).
 * Ensures choices[0].message.content is a string.
 */
export function openAIChatSchema(): Parser<OpenAIChatResponse> {
  return {
    parse(raw: unknown): OpenAIChatResponse {
      if (!isOpenAIChatResponse(raw)) {
        throw new Error('Invalid OpenAI chat response: expected choices[0].message.content as string');
      }
      return raw;
    },
  };
}

/**
 * Anthropic Messages API "schema" returning a parser with .parse(raw).
 * Ensures content[0].text is a string.
 */
export function anthropicSchema(): Parser<AnthropicResponse> {
  return {
    parse(raw: unknown): AnthropicResponse {
      if (!isAnthropicResponse(raw)) {
        throw new Error('Invalid Anthropic response: expected content[0].text as string');
      }
      return raw;
    },
  };
}

/**
 * Google Gemini generateContent "schema" returning a parser with .parse(raw).
 * Ensures candidates[0].content.parts exists; later we find a part with non-empty text.
 */
export function geminiSchema(): Parser<GeminiResponse> {
  return {
    parse(raw: unknown): GeminiResponse {
      if (!isGeminiResponse(raw)) {
        throw new Error('Invalid Gemini response: expected candidates[0].content.parts array');
      }
      return raw;
    },
  };
}

// ------------ Normalized response "schema" (public) ------------

/**
 * Schema for normalized output. Allows partial metadata during parsing; defaults are applied later.
 * - issues: missing issues is treated as [] (empty array)
 * - metadata: optional; fields validated if present
 */
export function normalizedResponseSchema(): Parser<{
  issues: ContinuityIssue[];
  metadata?:
    | {
        modelUsed?: string;
        provider?: ProviderName;
        costEstimate?: number;
        durationMs?: number;
        confidence?: number;
        cached?: boolean;
      }
    | undefined;
}> {
  return {
    parse(
      raw: unknown
    ): {
      issues: ContinuityIssue[];
      metadata?:
        | {
            modelUsed?: string;
            provider?: ProviderName;
            costEstimate?: number;
            durationMs?: number;
            confidence?: number;
            cached?: boolean;
          }
        | undefined;
    } {
      if (!isObject(raw)) {
        throw new Error('Invalid normalized response: expected an object');
      }

      const issuesRaw = (raw as Record<string, unknown>).issues;
      let issues: ContinuityIssue[] = [];
      if (issuesRaw === undefined) {
        issues = [];
      } else {
        if (!Array.isArray(issuesRaw)) {
          throw new Error("Invalid normalized response: 'issues' must be an array");
        }
        issuesRaw.forEach((item, idx) => {
          if (!isContinuityIssue(item)) {
            // Provide a precise messaging on failure
            throw new Error(`Invalid ContinuityIssue at index ${idx}`);
          }
        });
        issues = issuesRaw as ContinuityIssue[];
      }

      const metadata = validateNormalizedMetadata((raw as Record<string, unknown>).metadata);

      return { issues, metadata };
    },
  };
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
    const firstWithText = parts.find(
      (p: { text?: string }) => typeof p.text === 'string' && ((p.text?.length ?? 0) > 0)
    );
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