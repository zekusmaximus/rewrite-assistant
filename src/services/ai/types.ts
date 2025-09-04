// AI service shared types for continuity analysis
// Strict TypeScript compatible

import { Scene, ContinuityIssue, ReaderKnowledge } from '../../shared/types';

/**
 * Provider identifiers supported by this AI subsystem.
 */
export type ProviderName = 'anthropic' | 'openai' | 'google';

/**
 * Describes a model's strengths and operational constraints for routing.
 */
export interface ModelCapabilities {
  model: string;
  provider: ProviderName;
  strengths: Array<
    | 'narrative-flow'
    | 'character-voice'
    | 'complex-reasoning'
    | 'deep-analysis'
    | 'instruction-following'
    | 'validation'
    | 'full-manuscript'
    | 'bulk-analysis'
  >;
  costTier: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

/**
 * Variants of analysis the system can perform.
 */
export type AnalysisType = 'simple' | 'consistency' | 'complex' | 'full';

/**
 * Request payload for continuity analysis.
 */
export interface AnalysisRequest {
  scene: Scene;
  previousScenes: Scene[];
  analysisType: AnalysisType;
  readerContext: ReaderKnowledge;
}

/**
 * Normalized response from any provider after validation.
 */
export interface AnalysisResponse {
  issues: ContinuityIssue[];
  metadata: {
    modelUsed: string;
    provider: ProviderName;
    costEstimate: number;
    durationMs: number;
    confidence: number;
    cached: boolean;
  };
}

/**
 * Base configuration for providers.
 * TODO: Integrate Electron safeStorage for apiKey handling in production.
 */
export interface BaseProviderConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  rateLimitPerMin?: number;
  baseUrl?: string;
}

/**
 * Claude (Anthropic) provider configuration.
 */
export interface ClaudeConfig extends BaseProviderConfig {}

/**
 * OpenAI provider configuration.
 */
export interface OpenAIConfig extends BaseProviderConfig {}

/**
 * Gemini (Google) provider configuration.
 */
export interface GeminiConfig extends BaseProviderConfig {}

/**
 * Base error for provider-related failures.
 */
export class ProviderError extends Error {
  public readonly provider: ProviderName;
  public readonly status?: number;
  public readonly isRetriable: boolean;
  public readonly causeOriginal?: unknown;

  constructor(
    provider: ProviderName,
    message: string,
    options?: { status?: number; cause?: unknown; retriable?: boolean }
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = options?.status;
    this.isRetriable = Boolean(options?.retriable);
    this.causeOriginal = options?.cause;
  }
}

/**
 * Specialized error for rate limit exceedance (HTTP 429, etc).
 */
export class RateLimitError extends Error {
  public readonly provider: ProviderName;

  constructor(provider: ProviderName, message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
    this.provider = provider;
  }
}

/**
 * Schema or shape validation failure for provider outputs.
 */
export class ValidationError extends Error {
  public readonly provider: ProviderName;

  constructor(provider: ProviderName, message = 'Response validation failed') {
    super(message);
    this.name = 'ValidationError';
    this.provider = provider;
  }
}

/**
 * Thrown when a provider's circuit breaker is OPEN.
 */
export class CircuitBreakerOpenError extends Error {
  public readonly provider: string;

  constructor(provider: string, message = 'Circuit breaker open') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.provider = provider;
  }
}

/**
 * Thrown when a provider call times out.
 */
export class TimeoutError extends Error {
  public readonly provider: ProviderName;
  public readonly timeoutMs: number;

  constructor(provider: ProviderName, timeoutMs: number, message?: string) {
    super(message ?? `Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}
// Extend AnalysisRequest to support custom prompts for rewriting
export interface AnalysisRequestExtension {
  customPrompt?: string;
  isRewriteRequest?: boolean;
  preserveElements?: string[];
}