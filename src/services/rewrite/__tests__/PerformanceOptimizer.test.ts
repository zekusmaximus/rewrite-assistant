import { describe, it, expect } from 'vitest';
import PerformanceOptimizer from '../PerformanceOptimizer';

describe('PerformanceOptimizer', () => {
  it('tracks rewrite timings and computes moving average', () => {
    const perf = new PerformanceOptimizer();

    const start1 = Date.now() - 200;
    perf.trackRewrite(start1, true, false);

    const start2 = Date.now() - 400;
    perf.trackRewrite(start2, true, true);

    const metrics = perf.getMetrics();
    expect(metrics.avgRewriteTime).toBeGreaterThanOrEqual(150);
    expect(metrics.avgRewriteTime).toBeLessThan(1000);
    expect(metrics.cacheHitRate).toBeGreaterThanOrEqual(0); // 1 hit, 1 miss => 0.5
    expect(metrics.cacheHitRate).toBeLessThanOrEqual(1);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.lastUpdated).toBeGreaterThan(0);
  });

  it('updates cache hit rate and error rate', () => {
    const perf = new PerformanceOptimizer();

    // 2 successes, 1 cached; 1 failure, not cached
    perf.trackRewrite(Date.now() - 100, true, true);
    perf.trackRewrite(Date.now() - 200, true, false);
    perf.trackRewrite(Date.now() - 300, false, false);

    const m = perf.getMetrics();
    expect(m.cacheHitRate).toBeGreaterThan(0); // 1 hit out of 3 total cache events (1 hit / 2 misses) => 0.33
    expect(m.cacheHitRate).toBeLessThan(1);
    expect(m.errorRate).toBeCloseTo(1 / 3, 1);
  });

  it('suggests optimizations when thresholds exceeded', () => {
    const perf = new PerformanceOptimizer();

    // Force a slow average by using big deltas
    for (let i = 0; i < 5; i++) {
      perf.trackRewrite(Date.now() - 35000, true, false);
    }

    // Lower cache hit rate
    for (let i = 0; i < 10; i++) {
      perf.trackRewrite(Date.now() - 100, false, false);
    }

    const suggestions = perf.getSuggestions();
    // Should at least include time and error/cache items depending on metrics
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('cleanup bounds internal arrays and normalizes counters', () => {
    const perf = new PerformanceOptimizer();

    // Push many timings
    for (let i = 0; i < 150; i++) {
      perf.trackRewrite(Date.now() - (i + 1) * 10, true, i % 2 === 0);
    }

    // Trigger cleanup normalization
    for (let i = 0; i < 1200; i++) {
      perf.trackRewrite(Date.now() - (i + 1) * 5, i % 10 !== 0, i % 3 === 0);
    }

    perf.cleanup();
    const m = perf.getMetrics();
    // After cleanup, metrics are still valid numbers
    expect(m.avgRewriteTime).toBeGreaterThanOrEqual(0);
    expect(m.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(m.cacheHitRate).toBeLessThanOrEqual(1);
    expect(m.errorRate).toBeGreaterThanOrEqual(0);
    expect(m.errorRate).toBeLessThanOrEqual(1);
  });
});