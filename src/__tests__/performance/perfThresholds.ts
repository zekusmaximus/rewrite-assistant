import type { ThroughputResult, MemoryResult } from './BenchmarkHarness';

function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mbToBytes(mb: number): number {
  return Math.max(0, Math.floor(mb * 1024 * 1024));
}

function kbToBytes(kb: number): number {
  return Math.max(0, Math.floor(kb * 1024));
}

export const PERFORMANCE_THRESHOLDS = {
  analysisPerScene: {
    p50: envNumber('PERF_P50_MS', 100),
    p95: envNumber('PERF_P95_MS', 500),
    p99: envNumber('PERF_P99_MS', 1000),
  },
  memory: {
    maxHeapGrowth: mbToBytes(envNumber('PERF_MAX_HEAP_MB', 500)),
    perSceneOverhead: kbToBytes(envNumber('PERF_PER_SCENE_OVERHEAD_KB', 1024)),
  },
  ui: {
    maxBlockingTime: envNumber('PERF_MAX_BLOCKING_MS', 50),
    targetFPS: envNumber('PERF_TARGET_FPS', 30),
  },
} as const;

export function validateThroughput(r: ThroughputResult): { pass: boolean; details: string } {
  const { p50, p95, p99 } = r.percentiles;
  const t = PERFORMANCE_THRESHOLDS.analysisPerScene;
  const ok50 = p50 <= t.p50;
  const ok95 = p95 <= t.p95;
  const ok99 = p99 <= t.p99;
  const pass = ok50 && ok95 && ok99;
  const details = `ms/scene p50=${p50.toFixed(2)} (<=${t.p50}), p95=${p95.toFixed(2)} (<=${t.p95}), p99=${p99.toFixed(2)} (<=${t.p99}); avg=${r.avgMsPerItem.toFixed(2)}; scenes/sec=${r.scenesPerSecond.toFixed(2)}`;
  return { pass, details };
}

export function validateMemory(r: MemoryResult, items?: number): { pass: boolean; details: string } {
  const limits = PERFORMANCE_THRESHOLDS.memory;
  const growthOk = r.heapDiff <= limits.maxHeapGrowth;
  const perSceneOk = typeof items === 'number' && items > 0 ? r.heapDiff <= limits.perSceneOverhead * items : true;
  const pass = growthOk && perSceneOk;
  const details = `heap before=${(r.beforeHeap / (1024 * 1024)).toFixed(2)}MB after=${(r.afterHeap / (1024 * 1024)).toFixed(2)}MB diff=${(r.heapDiff / (1024 * 1024)).toFixed(2)}MB peak=${(r.peakHeap / (1024 * 1024)).toFixed(2)}MB; limits: maxGrowth=${(limits.maxHeapGrowth / (1024 * 1024)).toFixed(0)}MB` + (typeof items === 'number' ? `, perScene*items=${((limits.perSceneOverhead * items) / (1024 * 1024)).toFixed(2)}MB` : '');
  return { pass, details };
}

export function validateUI(lagMs: number): { pass: boolean; details: string } {
  const ui = PERFORMANCE_THRESHOLDS.ui;
  const fps = 1000 / Math.max(1, lagMs);
  const pass = lagMs <= ui.maxBlockingTime && fps >= ui.targetFPS;
  const details = `lag=${lagMs.toFixed(2)}ms (<=${ui.maxBlockingTime}ms), fps≈${fps.toFixed(1)} (>=${ui.targetFPS})`;
  return { pass, details };
}