import { CircuitBreakerOpenError } from '../types';

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerOptions {
  failureThresholdMs?: number;
  maxFailures?: number;
  recoveryTimeoutMs?: number;
}

interface ProviderState {
  state: State;
  failures: number[];
  lastOpenedAt?: number;
}

/**
 * Exponential backoff schedule (ms): 1000, 2000, 4000, 8000, 16000
 */
export function backoffSchedule(): number[] {
  return [1000, 2000, 4000, 8000, 16000];
}

/**
 * Per-provider circuit breaker implementation.
 * - Failure threshold: maxFailures within failureThresholdMs window
 * - States: CLOSED - normal, OPEN - short-circuit, HALF_OPEN - trial after timeout
 */
export class CircuitBreaker {
  private readonly failureThresholdMs: number;
  private readonly maxFailures: number;
  private readonly recoveryTimeoutMs: number;

  private readonly providers: Map<string, ProviderState> = new Map();

  constructor(opts: BreakerOptions = {}) {
    this.failureThresholdMs = opts.failureThresholdMs ?? 60_000;
    this.maxFailures = opts.maxFailures ?? 5;
    this.recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 30_000;
  }

  /**
   * Throws CircuitBreakerOpenError if provider is OPEN and not yet eligible for HALF_OPEN trial.
   */
  public beforeCall(providerKey: string): void {
    const st = this.ensure(providerKey);
    const now = Date.now();

    if (st.state === 'OPEN') {
      if (st.lastOpenedAt && now - st.lastOpenedAt >= this.recoveryTimeoutMs) {
        st.state = 'HALF_OPEN';
      } else {
        throw new CircuitBreakerOpenError(providerKey, `Circuit OPEN for ${providerKey}`);
      }
    }
  }

  /**
   * Mark a successful call. Resets state and failure counters.
   */
  public onSuccess(providerKey: string): void {
    const st = this.ensure(providerKey);
    st.failures = [];
    st.state = 'CLOSED';
    st.lastOpenedAt = undefined;
  }

  /**
   * Mark a failed call. Tracks rolling failures and opens the circuit when threshold exceeded.
   */
  public onFailure(providerKey: string, _err: unknown): void {
    const st = this.ensure(providerKey);
    const now = Date.now();
    // Track failure
    st.failures.push(now);
    // Prune old failures
    st.failures = st.failures.filter(ts => now - ts <= this.failureThresholdMs);

    if (st.failures.length >= this.maxFailures) {
      st.state = 'OPEN';
      st.lastOpenedAt = now;
    } else if (st.state === 'HALF_OPEN') {
      // Trial failed - re-open immediately
      st.state = 'OPEN';
      st.lastOpenedAt = now;
    }
  }

  /**
   * Get current state for diagnostics and tests.
   */
  public getState(providerKey: string): State {
    return this.ensure(providerKey).state;
  }

  // Internal

  private ensure(providerKey: string): ProviderState {
    let st = this.providers.get(providerKey);
    if (!st) {
      st = { state: 'CLOSED', failures: [] };
      this.providers.set(providerKey, st);
    }
    return st;
  }
}

export default CircuitBreaker;