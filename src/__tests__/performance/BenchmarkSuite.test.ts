import { describe, test, expect, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';

import GlobalAnalysisOrchestrator from '../../services/coherence/GlobalAnalysisOrchestrator';
import { BenchmarkHarness } from './BenchmarkHarness';
import { validateThroughput, validateMemory, validateUI } from './perfThresholds';
import { setupRealAIForTesting } from '../integration/testUtils';
import type { GlobalCoherenceSettings, Manuscript, Scene } from '../../shared/types';

const suite = describe; // Always run tests with test doubles

// Increase suite timeout to 2 minutes as requested

suite('Performance Benchmarks', () => {
  const harness = new BenchmarkHarness({ warmupRuns: 1, repetitions: 1, reportDir: 'reports/perf', monitorEventLoop: true });

  // Utility: minimal settings to avoid heavy passes and any IO
  const quickSettings: GlobalCoherenceSettings = {
    enableTransitions: true,
    enableSequences: false,
    enableChapters: false,
    enableArc: false,
    enableSynthesis: false,
    depth: 'quick',
    stopOnCritical: false,
  };

  async function buildOrchestrator(_latencyMs = 0) {
    const ai = await setupRealAIForTesting();
    const orch = new GlobalAnalysisOrchestrator(ai as any, { enableCache: false, delayBetweenItemsMs: 0 });
    return orch;
  }


  // Build per-item operation for "throughput" that analyzes a single transition using orchestrator on two-scene slices
  function perItemTransitionOpFactory(allScenes: Scene[]): (i: number) => Promise<void> {
    let orchPromise: Promise<GlobalAnalysisOrchestrator> | null = null;
    const getOrch = () => orchPromise ?? (orchPromise = buildOrchestrator(0));
    return async (i: number) => {
      const orch = await getOrch();
      const a = allScenes[i % allScenes.length];
      const b = allScenes[(i + 1) % allScenes.length];
      const manuscript: Manuscript = {
        id: `m-slice-${i}`,
        title: 'slice',
        scenes: [ { ...a, position: 0, originalPosition: 0 }, { ...b, position: 1, originalPosition: 1 } ],
        originalOrder: [a.id, b.id],
        currentOrder: [a.id, b.id],
      } as Manuscript;
      await orch.analyzeGlobalCoherence(manuscript, quickSettings);
    };
  }

  // Analysis Throughput
  describe('Analysis Throughput', () => {
    test.each([10, 50, 100, 500])('should analyze %i scenes efficiently', async (sceneCount) => {
      const manuscript = await harness.generateManuscript(sceneCount);
      const operation = perItemTransitionOpFactory(manuscript.scenes);
      const result = await harness.measureThroughput(operation, sceneCount);
      harness.throughput.set(`throughput-${sceneCount}`, result);

      const v = validateThroughput(result);
      expect(v.pass, v.details).toBe(true);
    }, 120000);
  });

  // Memory Usage
  describe('Memory Usage', () => {
    const hasGC = typeof global.gc === 'function';
    if (!hasGC) {
       
      console.warn('[BenchmarkSuite] global.gc not available; run Node with --expose-gc to enable strict leak test');
    }

    (hasGC ? test : test.skip)('should not leak memory during repeated operations', async () => {
      const sceneCount = 20;
      const manuscript = await harness.generateManuscript(sceneCount);
      const orch = await buildOrchestrator(0);

      const op = async () => {
        await orch.analyzeGlobalCoherence({ ...manuscript, id: `m-mem-${Date.now()}` }, quickSettings);
      };

      const mem = await harness.measureMemory(op, 6);
      harness.memory.set('memory-leak', mem);

      const check = validateMemory(mem, sceneCount);
      expect(check.pass, check.details).toBe(true);
    }, 120000);

    test('should handle 500+ scenes without excessive memory', async () => {
      const sceneCount = 500;
      const manuscript = await harness.generateManuscript(sceneCount);
      const orch = await buildOrchestrator(0);

      const mem = await harness.measureMemory(async () => {
        await orch.analyzeGlobalCoherence(manuscript, quickSettings);
      }, 1);

      harness.memory.set('memory-500', mem);

      const check = validateMemory(mem, sceneCount);
      expect(check.pass, check.details).toBe(true);
    }, 120000);
  });

  // Concurrent Performance
  test('should handle parallel scene analysis', async () => {
    // Use ContinuityAnalyzer for realistic per-scene compute and cache disabled to measure execution
    const { default: ContinuityAnalyzer } = await import('../../renderer/features/analyze/services/ContinuityAnalyzer');
    const ai = await setupRealAIForTesting();
    const analyzer = new ContinuityAnalyzer({ enableCache: false });

    const sceneCount = 60;
    const manuscript = await harness.generateManuscript(sceneCount);
    const prevOf = (idx: number) => manuscript.scenes.slice(0, idx);

    // Serial
    const t0 = performance.now();
    for (let i = 0; i < sceneCount; i++) {
      await analyzer.analyzeScene(manuscript.scenes[i], prevOf(i), ai as any, { includeEngagement: false });
    }
    const t1 = performance.now();
    const serialMs = t1 - t0;

    // Limited concurrency (6)
    const limit = 6;
    const queue: number[] = Array.from({ length: sceneCount }, (_, i) => i);
    const workers: Promise<void>[] = [];
    for (let k = 0; k < limit; k++) {
      workers.push((async () => {
        while (queue.length) {
          const idx = queue.shift();
          if (idx === undefined) break;
          await analyzer.analyzeScene(manuscript.scenes[idx], prevOf(idx), ai as any, { includeEngagement: false });
        }
      })());
    }
    const p0 = performance.now();
    await Promise.all(workers);
    const p1 = performance.now();
    const parallelMs = p1 - p0;

    // Collect as a latency entry
    harness.latency.set('concurrent', {
      samples: 2,
      avgMs: (serialMs + parallelMs) / 2,
      p50: Math.min(serialMs, parallelMs),
      p95: Math.max(serialMs, parallelMs),
      p99: Math.max(serialMs, parallelMs),
    });

    // Sanity: parallel should not be slower than serial by a wide margin; prefer faster
    expect(parallelMs).toBeLessThanOrEqual(serialMs * 1.05);
  }, 120000);

  // Cache Effectiveness
  test('should improve performance on repeated analysis', async () => {
    const { default: ContinuityAnalyzer } = await import('../../renderer/features/analyze/services/ContinuityAnalyzer');
    const ai = await setupRealAIForTesting();
    const analyzer = new ContinuityAnalyzer({ enableCache: true });
    const sceneCount = 80;
    const manuscript = await harness.generateManuscript(sceneCount);
    const prevOf = (idx: number) => manuscript.scenes.slice(0, idx);

    // Cold pass (fills cache)
    const cold = await harness.measureThroughput(async (i) => {
      const idx = i % sceneCount;
      await analyzer.analyzeScene(manuscript.scenes[idx], prevOf(idx), ai as any, { includeEngagement: false });
    }, sceneCount);

    // Warm pass (reads from cache)
    const warm = await harness.measureThroughput(async (i) => {
      const idx = i % sceneCount;
      await analyzer.analyzeScene(manuscript.scenes[idx], prevOf(idx), ai as any, { includeEngagement: false });
    }, sceneCount);

    harness.throughput.set('cache-cold', cold);
    harness.throughput.set('cache-warm', warm);

    // Warm should be at least 30% faster on average
    expect(warm.avgMsPerItem).toBeLessThanOrEqual(cold.avgMsPerItem * 0.7);
  }, 120000);

  // UI Responsiveness
  test('should maintain responsiveness during analysis', async () => {
    const sceneCount = 200;
    const manuscript = await harness.generateManuscript(sceneCount);
    // Add a tiny latency to simulate ongoing work
    const orch = await buildOrchestrator(2);

    let running = true;
    const bg = (async () => {
      try {
        await orch.analyzeGlobalCoherence(manuscript, quickSettings);
      } finally {
        running = false;
      }
    })();

    // Interleave UI probes
    let worstLag = 0;
    while (running) {
      const lag = await harness.simulateUIInteraction();
      worstLag = Math.max(worstLag, lag);
      // Break if enough samples while background still running
      if (worstLag > 0 && worstLag < 5) {
        // collect a few more quickly
      }
      if (worstLag > 50) break; // early break in worst-case
    }
    await bg;

    const ui = validateUI(worstLag);
    harness.latency.set('ui', { samples: 1, avgMs: worstLag, p50: worstLag, p95: worstLag, p99: worstLag });
    expect(ui.pass, ui.details).toBe(true);
  }, 120000);

  // Reporting and Baseline comparison
  afterAll(async () => {
    // Persist reports
    await harness.writeReports('benchmark');

    // Compare to baseline if present
    const dir = path.resolve(process.cwd(), harness.reportDir);
    const baselinePath = path.join(dir, 'baseline.json');
    let baseline: import('./BenchmarkHarness').BenchmarkReport | null = null;
    try {
      const raw = await fs.readFile(baselinePath, 'utf-8');
      baseline = JSON.parse(raw);
    } catch {
      baseline = null;
    }

    if (baseline) {
      const comparison = harness.compareToBaseline(baseline);
      const regressions = comparison.regressions ?? [];
      const isCI = harness.ciMode;

      if (isCI) {
        if (regressions.length > 0) {
          throw new Error(`Baseline regressions detected: ${regressions.join('; ')}`);
        }
      } else {
        if (regressions.length > 0) {
          // warn-only in non-CI
           
          console.warn('[BenchmarkSuite] Baseline regressions (non-CI, warn-only):', regressions);
        }
      }
    }
  });
});