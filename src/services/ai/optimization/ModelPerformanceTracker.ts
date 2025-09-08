/**
 * Lightweight in-memory model performance tracker with EMA metrics.
 * Tracks confidence, latency, and success as exponential moving averages per (modelId, taskType).
 *
 * - No disk persistence in this step.
 * - score() combines inverse-latency, EMA confidence, and EMA success into [0,1],
 *   with an optional penalty for relative model cost provided by the caller.
 */

export type TaskTypeKey = string;

type Key = string;

interface EmaRecord {
  emaConfidence: number | null;
  emaLatencyMs: number | null;
  emaSuccess: number | null;
  samples: number;
  lastUpdatedAt: number | null;
  // Keep the last reported token usage if available (not aggregated for now)
  lastTokenUsage?: { input: number; output: number };
}

export interface MetricsView {
  avgConfidence: number; // [0,1]
  successRate: number; // [0,1]
  avgLatencyMs: number; // >= 0
  samples: number;
  lastUpdatedAt: number | null;
}

export interface ScoreOptions {
  /**
   * Relative cost penalty in [0,1], where 0 = cheap, 1 = expensive.
   * The caller computes this from their cost class and passes it in.
   */
  costWeight?: number;
  /**
   * Weight of latency contribution. Default 0.3
   */
  latencyWeight?: number;
  /**
   * Weight of accuracy contribution (confidence + success). Default 0.7
   */
  accuracyWeight?: number;
}

function makeKey(modelId: string, taskType: TaskTypeKey): Key {
  return `${modelId}::${taskType}`;
}

// Tunable constants (kept simple and local for now)
const EMA_ALPHA = 0.3; // smoothing factor
const DEFAULT_CONFIDENCE = 0.6;
const DEFAULT_SUCCESS = 0.6;
const DEFAULT_LATENCY_MS = 1500;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function emaUpdate(prev: number | null, next: number, alpha: number): number {
  if (prev === null || !isFinite(prev)) return next;
  return alpha * next + (1 - alpha) * prev;
}

/**
 * Normalize latency to [0,1] with an inverse-latency curve.
 * Lower latency -> closer to 1. Uses a simple saturation constant.
 */
function inverseLatencyScore(latencyMs: number): number {
  const k = DEFAULT_LATENCY_MS; // characteristic time
  // 0ms -> ~1, k -> 0.5, large -> approaches 0
  const score = 1 / (1 + latencyMs / k);
  return clamp01(score);
}

export class ModelPerformanceTracker {
  private readonly store = new Map<Key, EmaRecord>();

  // Record the latest outcome for (modelId, taskType)
  public recordResult(
    modelId: string,
    taskType: string,
    outcome: {
      confidence: number;
      latencyMs: number;
      success: boolean;
      tokenUsage?: { input: number; output: number };
    }
  ): void {
    const key = makeKey(modelId, taskType);
    const rec = this.store.get(key) ?? {
      emaConfidence: null,
      emaLatencyMs: null,
      emaSuccess: null,
      samples: 0,
      lastUpdatedAt: null,
    };

    rec.emaConfidence = emaUpdate(rec.emaConfidence, clamp01(outcome.confidence), EMA_ALPHA);
    rec.emaLatencyMs = emaUpdate(rec.emaLatencyMs, Math.max(0, outcome.latencyMs), EMA_ALPHA);
    rec.emaSuccess = emaUpdate(rec.emaSuccess, outcome.success ? 1 : 0, EMA_ALPHA);
    rec.samples += 1;
    rec.lastUpdatedAt = Date.now();
    if (outcome.tokenUsage) {
      rec.lastTokenUsage = { ...outcome.tokenUsage };
    }

    this.store.set(key, rec);
  }

  // Retrieve a snapshot of current EMA metrics for (modelId, taskType)
  public getMetrics(modelId: string, taskType: string): MetricsView {
    const key = makeKey(modelId, taskType);
    const rec = this.store.get(key);
    if (!rec) {
      return {
        avgConfidence: DEFAULT_CONFIDENCE,
        successRate: DEFAULT_SUCCESS,
        avgLatencyMs: DEFAULT_LATENCY_MS,
        samples: 0,
        lastUpdatedAt: null,
      };
    }
    return {
      avgConfidence:
        typeof rec.emaConfidence === 'number' && isFinite(rec.emaConfidence)
          ? clamp01(rec.emaConfidence)
          : DEFAULT_CONFIDENCE,
      successRate:
        typeof rec.emaSuccess === 'number' && isFinite(rec.emaSuccess)
          ? clamp01(rec.emaSuccess)
          : DEFAULT_SUCCESS,
      avgLatencyMs:
        typeof rec.emaLatencyMs === 'number' && isFinite(rec.emaLatencyMs)
          ? Math.max(0, rec.emaLatencyMs)
          : DEFAULT_LATENCY_MS,
      samples: rec.samples,
      lastUpdatedAt: rec.lastUpdatedAt,
    };
  }

  /**
   * Compute a scalar score in [0,1] that favors:
   * - Higher confidence/success
   * - Lower latency (via inverse-latency normalization)
   * Optionally penalized by caller-provided costWeight in [0,1].
   */
  public score(
    modelId: string,
    taskType: string,
    opts?: { costWeight?: number; latencyWeight?: number; accuracyWeight?: number }
  ): number {
    const { avgConfidence, successRate, avgLatencyMs } = this.getMetrics(modelId, taskType);

    const latencyScore = inverseLatencyScore(avgLatencyMs);
    const accuracy = 0.5 * clamp01(avgConfidence) + 0.5 * clamp01(successRate);

    const latencyWeight = opts?.latencyWeight ?? 0.3;
    const accuracyWeight = opts?.accuracyWeight ?? 0.7;

    const base = clamp01(accuracyWeight * accuracy + latencyWeight * latencyScore);

    // Optional cost penalty (caller provides a normalized [0,1] weight)
    const costWeight = clamp01(opts?.costWeight ?? 0);
    // Cap penalty to 30% of the score to avoid over-penalizing
    const penaltyFactor = 1 - 0.3 * costWeight;

    return clamp01(base * penaltyFactor);
  }
}

export default ModelPerformanceTracker;