import { AnalysisResponse as AppAnalysisResponse, ProviderName, ValidationError } from '../types';
import type { ContinuityIssue } from '../../../shared/types';
import { z } from 'zod';
import {
  AnalysisResponseSchema as AnalysisResponseZodSchema,
  type AnalysisResponse as ModelAnalysisResponse,
  IssueTypeEnum,
  SeverityEnum,
} from '../schemas/ResponseSchemas';

/**
 * Minimal parser interface compatible with previous .parse(...) usage.
 * Each schema function returns an object with a parse method that throws on invalid input.
 */
type Parser<T> = {
  parse(value: unknown): T;
};

// ------------ Internal helpers and type guards (legacy compatibility) ------------

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
 * Runtime guard for ContinuityIssue (legacy ContinuityIssue used across app).
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

// ------------ Raw provider response shapes and guards (envelopes) ------------

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

/**
 * Legacy normalized response "schema" for ContinuityIssue[] (kept for compatibility).
 * Public export maintained to avoid breaking external imports.
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

// ------------ Utilities: JSON extraction and sanitization ------------

/**
 * Extract the first JSON object from arbitrary text using bracket counting.
 * Handles nested braces and ignores braces inside strings.
 */
export function extractJsonFromText(text: string): string {
  // Strip code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1];
  }

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

function stripBOM(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
function replaceSmartQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}
function removeComments(s: string): string {
  // Remove //... and /* ... */
  return s.replace(/\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g, '');
}
function removeTrailingCommas(s: string): string {
  // Remove trailing commas before } or ]
  return s.replace(/,(\s*[}\]])/g, '$1');
}
function fixSingleQuotedKeysAndStrings(s: string): string {
  // 'key': value  -> "key": value
  s = s.replace(/([{,\s])'([A-Za-z0-9_]+)'\s*:/g, '$1"$2":');
  // :"value'like" -> conservative conversion for single-quoted string values
  s = s.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
  return s;
}
function quoteUnquotedKeys(s: string): string {
  // { key: ... , another_key: ... } -> quote keys
  return s.replace(/([{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}
function sanitizeJsonLike(s: string, { quoteKeys = false }: { quoteKeys?: boolean } = {}): string {
  let out = stripBOM(s);
  out = replaceSmartQuotes(out);
  out = removeComments(out);
  out = removeTrailingCommas(out);
  out = fixSingleQuotedKeysAndStrings(out);
  if (quoteKeys) {
    out = quoteUnquotedKeys(out);
  }
  return out;
}

/**
 * Fallback slice for the outermost JSON object when strict extraction fails.
 * Returns substring between the first '{' and the last '}' if present.
 */
function sliceOuterJson(s: string): string | null {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return s.slice(start, end + 1);
  }
  return null;
}

// ------------ Model response normalization and confidence scoring ------------

export type ValidationMeta = { attempts: number; repaired: boolean; errors: string[] };

function cleanText(s: string): string {
  return s.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalizeModelData(parsed: ModelAnalysisResponse): ModelAnalysisResponse {
  // Clone to avoid mutation of caller data
  const data: ModelAnalysisResponse = {
    issues: Array.isArray(parsed.issues) ? [...parsed.issues] : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    confidence: typeof parsed.confidence === 'number' ? clamp01(parsed.confidence) : undefined,
  };

  data.summary = cleanText(data.summary);

  const severityValues = SeverityEnum.options as readonly z.infer<typeof SeverityEnum>[];
  const typeValues = IssueTypeEnum.options as readonly z.infer<typeof IssueTypeEnum>[];

  data.issues = data.issues.map((issue: ModelAnalysisResponse['issues'][number]) => {
    let severity = issue.severity;
    // Case-insensitive severity coercion if needed (best-effort; schema enforces valid already)
    const sevLower = String(severity).toLowerCase();
    const sevCoerced = severityValues.find((v: z.infer<typeof SeverityEnum>) => v.toLowerCase() === sevLower) ?? severity;
    severity = sevCoerced as typeof issue.severity;

    let type = issue.type;
    const typeLower = String(type).toLowerCase();
    const typeCoerced =
      typeValues.find((v: z.infer<typeof IssueTypeEnum>) => v.toLowerCase() === typeLower) ?? type;
    type = typeCoerced as typeof issue.type;

    // Span normalization
    let span = issue.span ?? null;
    if (span) {
      const start = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(span.start_index)));
      const end = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(span.end_index)));
      span = {
        start_index: Math.max(0, Math.min(start, end)),
        end_index: Math.max(start, end),
      };
    }

    // Strings cleanup
    const explanation = cleanText(issue.explanation ?? '');
    const suggested_fix = cleanText(issue.suggested_fix ?? '');

    // Evidence cleanup, dedupe and cap
    const seen = new Set<string>();
    const evidence =
      Array.isArray(issue.evidence) ? issue.evidence.map((e: string) => cleanText(e)).filter((e: string) => e.length > 0) : [];
    const deduped: string[] = [];
    for (const e of evidence) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(e);
      }
      if (deduped.length >= 10) break;
    }

    // Confidence clamp if present
    let conf = issue.confidence;
    if (typeof conf === 'number') {
      conf = clamp01(conf);
    }

    return {
      type,
      severity,
      span: span ?? null,
      explanation,
      evidence: deduped,
      suggested_fix,
      confidence: conf,
    };
  });

  // Backfill issue confidences heuristically if missing
  const sevWeights: Record<z.infer<typeof SeverityEnum>, number> = {
    low: 0.4,
    medium: 0.6,
    high: 0.8,
    critical: 0.9,
  };

  data.issues = data.issues.map((issue: ModelAnalysisResponse['issues'][number]) => {
    if (typeof issue.confidence === 'number') return issue;
    let score = sevWeights[issue.severity] ?? 0.5;
    const bonus = Math.min(0.1, (issue.evidence?.length ?? 0) * 0.02);
    score += bonus;
    if (issue.span && Number.isFinite(issue.span.start_index) && Number.isFinite(issue.span.end_index)) {
      score += 0.05;
    }
    // Clamp into [0.35, 0.98]
    score = Math.max(0.35, Math.min(0.98, score));
    return { ...issue, confidence: clamp01(score) };
  });

  if (data.confidence === undefined) {
    const confidences = data.issues.map((i: ModelAnalysisResponse['issues'][number]) => i.confidence ?? 0);
    const mean = confidences.length ? confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length : 0;
    data.confidence = clamp01(mean);
  }

  return data;
}

// ------------ Parsing pipeline with retries and fallbacks ------------

type ParseAttemptResult =
  | { ok: true; data: ModelAnalysisResponse; meta: ValidationMeta }
  | { ok: false; meta: ValidationMeta };

function tryZodValidate(candidate: unknown): { ok: true; data: ModelAnalysisResponse } | { ok: false; error: string } {
  const res = AnalysisResponseZodSchema.safeParse(candidate);
  if (res.success) return { ok: true, data: res.data };
  return { ok: false, error: res.error.errors.map((e: z.ZodIssue) => e.message).join('; ') };
}

function parseModelOutputToZod(raw: unknown, retries = 3): ParseAttemptResult {
  const errors: string[] = [];
  let attempts = 0;
  let repaired = false;
  let extractedSub: string | null = null;

  // 0) Already-object case
  if (isObject(raw)) {
    attempts++;
    const z = tryZodValidate(raw);
    if (z.ok) {
      return { ok: true, data: normalizeModelData(z.data), meta: { attempts, repaired, errors } };
    } else {
      errors.push(`Zod validation failed on object: ${z.error}`);
      // Continue to stringify-sanitize attempts below
    }
  }

  const rawStr = isString(raw) ? raw : (() => {
    try {
      return JSON.stringify(raw);
    } catch {
      return '';
    }
  })();

  // Strategy 1: Strict JSON.parse on full string
  attempts++;
  try {
    const candidate = JSON.parse(stripBOM(rawStr));
    const z = tryZodValidate(candidate);
    if (z.ok) {
      return { ok: true, data: normalizeModelData(z.data), meta: { attempts, repaired, errors } };
    }
    errors.push(`Zod validation failed on strict JSON: ${z.error}`);
  } catch (e) {
    errors.push(`Strict JSON.parse failed: ${(e as Error)?.message ?? String(e)}`);
  }

  // Strategy 2: Extract first top-level JSON object substring (handles fences too)
  attempts++;
  try {
    const jsonSub = extractJsonFromText(rawStr);
    extractedSub = jsonSub;
    if (jsonSub !== rawStr) repaired = true;
    const candidate = JSON.parse(jsonSub);
    const z = tryZodValidate(candidate);
    if (z.ok) {
      return { ok: true, data: normalizeModelData(z.data), meta: { attempts, repaired, errors } };
    }
    errors.push(`Zod validation failed on extracted JSON: ${z.error}`);
  } catch (e) {
    // Keep extractedSub as whatever was found (if any), but note failure
    repaired = true;
    errors.push(`Extraction/parse failed: ${(e as Error)?.message ?? String(e)}`);
  }

  // Strategy 3: Sanitize common issues (smart quotes, single quotes, trailing commas, comments)
  attempts++;
  try {
    const base = extractedSub ?? sliceOuterJson(rawStr) ?? rawStr;
    const sanitized = sanitizeJsonLike(base);
    if (sanitized !== base) repaired = true;
    const candidate = JSON.parse(sanitized);
    const z = tryZodValidate(candidate);
    if (z.ok) {
      return { ok: true, data: normalizeModelData(z.data), meta: { attempts, repaired, errors } };
    }
    errors.push(`Zod validation failed after sanitize: ${z.error}`);
  } catch (e) {
    repaired = true;
    errors.push(`Sanitize/parse failed: ${(e as Error)?.message ?? String(e)}`);
  }

  // Strategy 3b: Quote unquoted keys conservatively
  attempts++;
  try {
    const base = extractedSub ?? sliceOuterJson(rawStr) ?? rawStr;
    const sanitized = sanitizeJsonLike(base, { quoteKeys: true });
    if (sanitized !== base) repaired = true;
    const candidate = JSON.parse(sanitized);
    const z = tryZodValidate(candidate);
    if (z.ok) {
      return { ok: true, data: normalizeModelData(z.data), meta: { attempts, repaired, errors } };
    }
    errors.push(`Zod validation failed after quoting keys: ${z.error}`);
  } catch (e) {
    repaired = true;
    errors.push(`Quote-keys/parse failed: ${(e as Error)?.message ?? String(e)}`);
  }

  // Strategy 4: JSON5 (optional, skipped if not installed)
  // Note: json5 is not in deps by default; skip silently.
  // If added later, this can be enabled with a dynamic import.

  // Respect retries cap (we have already performed multiple attempts)
  if (attempts >= Math.max(1, retries)) {
    return { ok: false, meta: { attempts, repaired, errors } };
  }

  return { ok: false, meta: { attempts, repaired, errors } };
}

// ------------ Provider payload extraction (envelopes) ------------

function extractTextPayload(provider: ProviderName, raw: unknown): string {
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
}

// ------------ Mapping to application-level AnalysisResponse (legacy) ------------

function mapIssueTypeToLegacy(t: z.infer<typeof IssueTypeEnum>): ContinuityIssue['type'] {
  switch (t) {
    case 'pronoun_reference':
      return 'pronoun';
    case 'timeline':
      return 'timeline';
    case 'character_knowledge':
      return 'character';
    case 'other':
    default:
      return 'context';
  }
}

function mapSeverityToLegacy(s: z.infer<typeof SeverityEnum>): ContinuityIssue['severity'] {
  switch (s) {
    case 'low':
      return 'consider';
    case 'medium':
      return 'should-fix';
    case 'high':
    case 'critical':
    default:
      return 'must-fix';
  }
}

function modelToLegacyIssues(data: ModelAnalysisResponse): ContinuityIssue[] {
  return (data.issues ?? []).map((i: ModelAnalysisResponse['issues'][number]) => {
    const start = i.span?.start_index ?? 0;
    const end = i.span?.end_index ?? Math.max(0, start);
    return {
      type: mapIssueTypeToLegacy(i.type),
      severity: mapSeverityToLegacy(i.severity),
      description: i.explanation ?? '',
      textSpan: [Math.max(0, Math.trunc(start)), Math.max(0, Math.trunc(end))],
      suggestedFix: i.suggested_fix ? String(i.suggested_fix) : undefined,
    };
  });
}

// ------------ Public API (overloaded) ------------

export function validateAndNormalize(
  raw: unknown,
  options?: { retries?: number }
): { data: ModelAnalysisResponse; meta: ValidationMeta };
export function validateAndNormalize(
  provider: ProviderName,
  raw: unknown,
  fallbackModelLabel: string
): AppAnalysisResponse;
// Implementation
export function validateAndNormalize(
  a: unknown,
  b?: unknown,
  c?: unknown
): { data: ModelAnalysisResponse; meta: ValidationMeta } | AppAnalysisResponse {
  // Overload dispatcher
  if (isProviderName(a)) {
    // Legacy API: (provider, raw, fallbackModelLabel) -> AppAnalysisResponse
    const provider = a as ProviderName;
    const raw = b as unknown;
    const fallbackModelLabel = String(c ?? '');
    try {
      const payloadText = extractTextPayload(provider, raw);
      const result = parseModelOutputToZod(payloadText, 4);
      if (!result.ok) {
        throw new ValidationError(provider, 'Response validation failed');
      }
      const modelData = result.data; // already normalized and confidences filled
      const legacy: AppAnalysisResponse = {
        issues: modelToLegacyIssues(modelData),
        metadata: {
          modelUsed: fallbackModelLabel,
          provider,
          costEstimate: 0,
          durationMs: 0,
          confidence: typeof modelData.confidence === 'number' ? modelData.confidence : 0,
          cached: false,
        },
      };
      return legacy;
    } catch {
      throw new ValidationError(a as ProviderName, 'Response validation failed');
    }
  } else {
    // New primary API: (raw, options?) -> { data, meta }
    const retries = isObject(b) && isNumberFinite((b as any).retries) ? Math.max(1, Math.trunc((b as any).retries)) : 4;
    const result = parseModelOutputToZod(a, retries);
    if (!result.ok) {
      return { data: { issues: [], summary: '', confidence: 0 }, meta: result.meta };
    }
    return { data: result.data, meta: result.meta };
  }
}