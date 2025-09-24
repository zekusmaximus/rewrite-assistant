/**
 * Error classification helpers for AI-related failures shown in renderer.
 *
 * Exposes:
 * - ErrorType: 'key' | 'network' | 'service' | 'unknown'
 * - classifyError(error): ErrorType
 * - isTransientNetworkError(error): boolean
 */

export type ErrorType = 'key' | 'network' | 'service' | 'unknown';

type MaybeErrorLike = Partial<Error> & {
  code?: string | number;
  status?: number;
  response?: { status?: number } | null;
  name?: string;
  message?: string;
};

/**
 * Heuristics:
 * - 'MissingKeyError' | 'InvalidKeyError' => 'key'
 * - Network/timeout/DNS/fetch aborted => 'network'
 *   (names: 'NetworkError', 'AbortError'; codes: ECONNRESET, ENOTFOUND, ETIMEDOUT, ECONNREFUSED, EAI_AGAIN; message patterns)
 * - 'AIServiceError' | 'ProviderError' | 'ServiceUnavailableError' | 'RateLimitError' => 'service'
 * - 5xx/429 statuses => 'service'; 0/502/503/504 may also look network but we prefer 'network' when message/codes match
 * - default => 'unknown'
 */
export function classifyError(err: unknown): ErrorType {
  const e = (err ?? {}) as MaybeErrorLike;
  const name = String(e.name ?? '').trim();
  const code = String(e.code ?? '').trim().toUpperCase();
  const msg = String(e.message ?? '').toLowerCase();
  const status = numberOrUndefined(e.status) ?? numberOrUndefined(e.response?.status);

  // Key configuration issues
  if (name === 'MissingKeyError' || name === 'InvalidKeyError') {
    return 'key';
  }

  // Explicit network-ish error names
  if (name === 'NetworkError' || name === 'AbortError' || name === 'FetchError') {
    return 'network';
  }

  // Error codes commonly associated with transient network failures
  if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || code === 'ERR_NETWORK') {
    return 'network';
  }

  // Message patterns suggesting network trouble
  if (msgIncludesAny(msg, ['network', 'timeout', 'timed out', 'fetch', 'failed to fetch', 'econnreset', 'enotfound', 'etimedout', 'abort', 'aborted'])) {
    return 'network';
  }

  // Service-layer issues (provider returned error)
  if (name === 'AIServiceError' || name === 'ProviderError' || name === 'ServiceUnavailableError' || name === 'RateLimitError') {
    return 'service';
  }

  // HTTP-ish status hints if present
  if (typeof status === 'number') {
    if (status === 429 || (status >= 500 && status < 600)) {
      return 'service';
    }
    if (status === 0 || status === 502 || status === 503 || status === 504) {
      // Ambiguous between service and network; prefer network semantics for auto-retry
      return 'network';
    }
  }

  return 'unknown';
}

/**
 * Transient network error heuristic for auto-retry policy.
 * Returns true for network/timeout/DNS/aborted and common 5xx gateway issues.
 */
export function isTransientNetworkError(err: unknown): boolean {
  const e = (err ?? {}) as MaybeErrorLike;
  const name = String(e.name ?? '').trim();
  const code = String(e.code ?? '').trim().toUpperCase();
  const msg = String(e.message ?? '').toLowerCase();
  const status = numberOrUndefined(e.status) ?? numberOrUndefined(e.response?.status);

  if (name === 'AbortError') return true;

  if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || code === 'ERR_NETWORK') {
    return true;
  }

  if (msgIncludesAny(msg, ['timeout', 'timed out', 'temporarily unavailable', 'try again', 'fetch', 'failed to fetch', 'dns', 'abort', 'aborted'])) {
    return true;
  }

  if (typeof status === 'number') {
    if (status === 0) return true;
    if (status === 502 || status === 503 || status === 504) return true;
  }

  return false;
}

function numberOrUndefined(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : undefined;
  return Number.isFinite(n as number) ? (n as number) : undefined;
}

function msgIncludesAny(msg: string, needles: string[]): boolean {
  const m = msg || '';
  return needles.some((n) => m.includes(n));
}

export type { ErrorType as AIErrorType };