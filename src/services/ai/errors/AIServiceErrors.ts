// Structured AI error classification for renderer/main-safe usage

export abstract class AIServiceError extends Error {
  abstract readonly errorType: 'missing_key' | 'invalid_key' | 'service_unavailable' | 'network_error' | 'rate_limit';
  abstract readonly userMessage: string;
  abstract readonly retryable: boolean;

  constructor(message: string) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export class MissingKeyError extends AIServiceError {
  readonly errorType = 'missing_key' as const;
  readonly retryable = false;
  readonly userMessage: string;

  constructor(provider: string) {
    super(`Missing ${provider} API key - application cannot function without AI services`);
    this.name = 'MissingKeyError';
    this.userMessage = `${provider} API key required. Configure it in Settings to use this application.`;
  }
}

export class InvalidKeyError extends AIServiceError {
  readonly errorType = 'invalid_key' as const;
  readonly retryable = false;
  readonly userMessage: string;

  constructor(provider: string, details: string) {
    super(`Invalid ${provider} API key: ${details}`);
    this.name = 'InvalidKeyError';
    this.userMessage = `${provider} API key is invalid. Please check your key in Settings.`;
  }
}

export class ServiceUnavailableError extends AIServiceError {
  readonly errorType = 'service_unavailable' as const;
  readonly retryable = true;
  readonly userMessage = 'AI service is temporarily unavailable. Please try again in a moment.';

  constructor(provider: string, statusCode?: number) {
    super(`${provider} service unavailable (${statusCode || 'unknown'})`);
    this.name = 'ServiceUnavailableError';
  }
}

export class NetworkError extends AIServiceError {
  readonly errorType = 'network_error' as const;
  readonly retryable = true;
  readonly userMessage = 'Network connection failed. Please check your connection and try again.';

  constructor(details: string) {
    super(`Network error: ${details}`);
    this.name = 'NetworkError';
  }
}

export class RateLimitError extends AIServiceError {
  readonly errorType = 'rate_limit' as const;
  readonly retryable = true;
  readonly userMessage = 'Rate limit exceeded. Please wait a moment before trying again.';

  constructor(provider: string, retryAfter?: number) {
    super(`Rate limit exceeded for ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`);
    this.name = 'RateLimitError';
  }
}