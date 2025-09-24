import { performance, monitorEventLoopDelay } from 'perf_hooks';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Manuscript, Scene } from '../../shared/types';

// ========== Types ==========

export interface ThroughputResult {
  items: number;
  totalTimeMs: number;
  avgMsPerItem: number;
  percentiles: { p50: number; p95: number; p99: number };
  scenesPerSecond: number;
  notes?: string;
}

export interface MemoryResult {
  beforeHeap: number;
  afterHeap: number;
  heapDiff: number;
  peakHeap: number;
  repeats: number;
  notes?: string;
}

export interface LatencyResult {
  samples: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface EnvironmentInfo {
  node: string;
  platform: string;
  arch: string;
  cpus: number;
  totalMem: number;
  ci: boolean;
}

export interface BenchmarkReport {
  throughput: Record<string, ThroughputResult>;
  memory: Record<string, MemoryResult>;
  latency: Record<string, LatencyResult>;
  timestamp: string;
  environment: EnvironmentInfo;
}

export interface ComparisonResult {
  deltas: Record<string, any>;
  regressions: string[];
  improvements: string[];
}

// Minimal Manuscript-like type if import changes; we prefer canonical Manuscript
type ManuscriptLike = Manuscript;

// ========== Harness ==========

export class BenchmarkHarness {
  public readonly warmupRuns: number;
  public readonly repetitions: number;
  public readonly reportDir: string;
  public readonly monitorEventLoop: boolean;
  public readonly ciMode: boolean;

  private loopMonitor: ReturnType<typeof monitorEventLoopDelay> | null = null;
  private loopMonitorStarted = false;

  // Accumulators keyed by descriptive test names
  public throughput: Map<string, ThroughputResult> = new Map();
  public memory: Map<string, MemoryResult> = new Map();
  public latency: Map<string, LatencyResult> = new Map();

  constructor(opts?: {
    warmupRuns?: number;
    repetitions?: number;
    reportDir?: string;
    monitorEventLoop?: boolean;
    ciMode?: boolean;
  }) {
    this.warmupRuns = Math.max(0, opts?.warmupRuns ?? 1);
    this.repetitions = Math.max(1, opts?.repetitions ?? 1);
    this.reportDir = opts?.reportDir ?? 'reports/perf';
    this.monitorEventLoop = opts?.monitorEventLoop ?? true;
    this.ciMode = opts?.ciMode ?? (process.env.CI === 'true');

    if (this.monitorEventLoop && typeof monitorEventLoopDelay === 'function') {
      try {
        this.loopMonitor = monitorEventLoopDelay({ resolution: 10 });
        this.loopMonitor.enable();
        this.loopMonitorStarted = true;
      } catch {
        this.loopMonitor = null;
        this.loopMonitorStarted = false;
      }
    }
  }

  // ========== Measurement methods ==========

  /**
   * Runs warmups, then executes 'items' operations serially, measuring per-item latency.
   */
  async measureThroughput(
    operation: (i: number) => Promise<void>,
    items: number
  ): Promise<ThroughputResult> {
    const samples: number[] = [];
    const warmups = this.warmupRuns;

    for (let w = 0; w < warmups; w++) {
      try {
        await operation(-1);
      } catch {
        // ignore warmup errors
      }
    }

    const tStart = performance.now();
    for (let i = 0; i < items; i++) {
      const t0 = performance.now();
      await operation(i);
      const t1 = performance.now();
      samples.push(t1 - t0);
    }
    const tEnd = performance.now();

    const totalTimeMs = tEnd - tStart;
    const avgMsPerItem = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    const pct = this.computePercentiles(samples);
    const scenesPerSecond = avgMsPerItem > 0 ? (1000 / avgMsPerItem) : 0;

    return {
      items,
      totalTimeMs,
      avgMsPerItem,
      percentiles: pct,
      scenesPerSecond,
    };
  }

  /**
   * Measures heap usage before/after and peak heap across repeats.
   * Invokes global.gc() when available (recommended: node --expose-gc).
   */
  async measureMemory(
    operation: () => Promise<void>,
    repeats?: number
  ): Promise<MemoryResult> {
    const reps = Math.max(1, repeats ?? this.repetitions);

    // Helper to GC if available
    const runGC = async () => {
      if (typeof (global as any).gc === 'function') {
        try {
          (global as any).gc();
          // Give event loop a tick to settle
          await new Promise((r) => setTimeout(r, 0));
        } catch {
          // ignore
        }
      }
    };

    await runGC();
    const before = process.memoryUsage().heapUsed;
    let peak = before;

    for (let i = 0; i < reps; i++) {
      await operation();
      // sample around each repeat boundary
      const snap = process.memoryUsage().heapUsed;
      if (snap > peak) peak = snap;
      await runGC();
      const snapPostGC = process.memoryUsage().heapUsed;
      if (snapPostGC > peak) peak = snapPostGC;
    }

    const after = process.memoryUsage().heapUsed;
    const heapDiff = after - before;

    return {
      beforeHeap: before,
      afterHeap: after,
      heapDiff,
      peakHeap: peak,
      repeats: reps,
      notes: typeof (global as any).gc !== 'function' ? 'global.gc not available; consider running node with --expose-gc' : undefined,
    };
  }

  /**
   * Runs the operation multiple times to compute latency percentiles.
   */
  async measureLatency(
    operation: () => Promise<void>,
    samples: number = 20
  ): Promise<LatencyResult> {
    const S: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      await operation();
      const t1 = performance.now();
      S.push(t1 - t0);
    }
    const pct = this.computePercentiles(S);
    const avg = S.length ? S.reduce((a, b) => a + b, 0) / S.length : 0;
    return {
      samples: S.length,
      avgMs: avg,
      p50: pct.p50,
      p95: pct.p95,
      p99: pct.p99,
    };
  }

  // ========== Reporting ==========

  generateReport(): BenchmarkReport {
    const env: EnvironmentInfo = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus()?.length ?? 1,
      totalMem: os.totalmem?.() ?? 0,
      ci: this.ciMode,
    };

    const tp: Record<string, ThroughputResult> = {};
    for (const [k, v] of this.throughput.entries()) tp[k] = v;
    const mm: Record<string, MemoryResult> = {};
    for (const [k, v] of this.memory.entries()) mm[k] = v;
    const lt: Record<string, LatencyResult> = {};
    for (const [k, v] of this.latency.entries()) lt[k] = v;

    return {
      throughput: tp,
      memory: mm,
      latency: lt,
      timestamp: new Date().toISOString(),
      environment: env,
    };
  }

  async writeReports(basename?: string): Promise<{ jsonPath: string; mdPath: string }> {
    const ts = this.formatTimestamp(new Date());
    const base = basename ?? 'run';
    const dir = path.resolve(process.cwd(), this.reportDir);
    await fs.mkdir(dir, { recursive: true });

    const report = this.generateReport();
    const jsonPath = path.join(dir, `${base}-${ts}.json`);
    const mdPath = path.join(dir, `${base}-${ts}.md`);

    // JSON
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    // Markdown
    const md = this.renderMarkdownReport(report, await this.tryLoadBaseline(path.join(dir, 'baseline.json')));
    await fs.writeFile(mdPath, md, 'utf-8');

    return { jsonPath, mdPath };
  }

  compareToBaseline(baseline: BenchmarkReport): ComparisonResult {
    const current = this.generateReport();
    const deltas: Record<string, any> = {};
    const regressions: string[] = [];
    const improvements: string[] = [];

    // Throughput p95 comparisons
    for (const key of Object.keys(current.throughput)) {
      if (baseline.throughput[key]) {
        const curr = current.throughput[key].percentiles.p95;
        const base = baseline.throughput[key].percentiles.p95;
        const deltaPct = base === 0 ? 0 : ((curr - base) / base) * 100;
        deltas[`throughput.${key}.p95_delta_pct`] = deltaPct;
        if (deltaPct > 10) {
          regressions.push(`throughput ${key} p95 +${deltaPct.toFixed(1)}%`);
        } else if (deltaPct < -10) {
          improvements.push(`throughput ${key} p95 ${deltaPct.toFixed(1)}%`);
        }
      }
    }

    // Memory growth comparisons
    for (const key of Object.keys(current.memory)) {
      if (baseline.memory[key]) {
        const curr = current.memory[key].heapDiff;
        const base = baseline.memory[key].heapDiff;
        const deltaPct = base === 0 ? 0 : ((curr - base) / base) * 100;
        deltas[`memory.${key}.heapDiff_delta_pct`] = deltaPct;
        if (deltaPct > 10) {
          regressions.push(`memory ${key} heapDiff +${deltaPct.toFixed(1)}%`);
        } else if (deltaPct < -10) {
          improvements.push(`memory ${key} heapDiff ${deltaPct.toFixed(1)}%`);
        }
      }
    }

    return { deltas, regressions, improvements };
  }

  // ========== Utilities ==========

  /**
   * Build a manuscript-like object compatible with analyzers.
   * Uses fixtures and repeats text chunks to reach sceneCount.
   */
  async generateManuscript(sceneCount: number): Promise<ManuscriptLike> {
    const fixturesDir = path.join(process.cwd(), 'src', 'tests', 'fixtures');
    const files = ['small-manuscript.txt', 'medium-manuscript.txt', 'large-manuscript.txt'];
    const texts: string[] = [];
    for (const f of files) {
      try {
        const t = await fs.readFile(path.join(fixturesDir, f), 'utf-8');
        texts.push(t);
      } catch {
        // ignore missing fixture
      }
    }
    const seed = texts.join('\n\n').trim() || 'Chapter 1\nA short scene.\n\nChapter 2\nAnother scene.';
    const rawScenes = seed.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);

    const scenes: Scene[] = [];
    for (let i = 0; i < sceneCount; i++) {
      const base = rawScenes[i % rawScenes.length] || `Scene ${i + 1}`;
      const text = `${base}\n\n${(i % 5 === 0) ? 'Morning' : ''} ${(i % 7 === 0) ? 'library' : ''}`.trim();
      const id = `s${i + 1}`;
      const chars = this.extractCharacters(text);
      const timeMarkers = this.extractTimeMarkers(text);
      const locationMarkers = this.extractLocationMarkers(text);
      scenes.push({
        id,
        text,
        wordCount: this.countWords(text),
        position: i,
        originalPosition: i,
        characters: chars,
        timeMarkers,
        locationMarkers,
        hasBeenMoved: false,
        rewriteStatus: 'pending',
      } as Scene);
    }

    const manuscript: ManuscriptLike = {
      id: `m-${sceneCount}`,
      title: `Benchmark Manuscript ${sceneCount}`,
      scenes,
      originalOrder: scenes.map(s => s.id),
      currentOrder: scenes.map(s => s.id),
      filePath: undefined,
    };
    return manuscript;
  }

  /**
   * Schedule a microtask and a 0ms timeout to approximate UI responsiveness lag.
   * Returns the measured delay in ms for the timeout execution.
   */
  async simulateUIInteraction(): Promise<number> {
    await Promise.resolve(); // microtask
    const scheduledAt = performance.now();
    const lag = await new Promise<number>((resolve) => {
      setTimeout(() => {
        resolve(performance.now() - scheduledAt);
      }, 0);
    });
    return lag;
  }

  /**
   * Returns approximate event loop lag in ms using monitorEventLoopDelay if available.
   * If unsupported, returns 0 as a conservative fallback.
   */
  measureEventLoopLag(): number {
    if (this.loopMonitor && this.loopMonitorStarted) {
      // max is in nanoseconds
      const ns = this.loopMonitor.max;
      // reset statistics window for next read
      this.loopMonitor.reset();
      return Number(ns) / 1e6;
    }
    return 0;
  }

  // ========== Helpers ==========

  private computePercentiles(samples: number[]): { p50: number; p95: number; p99: number } {
    if (!samples.length) return { p50: 0, p95: 0, p99: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))];
    return {
      p50: q(50),
      p95: q(95),
      p99: q(99),
    };
    }

  private formatTimestamp(d: Date): string {
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  private async tryLoadBaseline(baselinePath: string): Promise<BenchmarkReport | null> {
    try {
      const raw = await fs.readFile(baselinePath, 'utf-8');
      return JSON.parse(raw) as BenchmarkReport;
    } catch {
      return null;
    }
  }

  private renderMarkdownReport(current: BenchmarkReport, baseline: BenchmarkReport | null): string {
    const lines: string[] = [];
    lines.push(`# Rewrite Assistant Performance Report`);
    lines.push('');
    lines.push(`Timestamp: ${current.timestamp}`);
    lines.push(`Environment: Node ${current.environment.node} | ${current.environment.platform}/${current.environment.arch} | CPUs: ${current.environment.cpus} | Mem: ${(current.environment.totalMem / (1024 * 1024 * 1024)).toFixed(1)} GB | CI: ${current.environment.ci}`);
    lines.push('');

    // Throughput
    lines.push(`## Throughput`);
    lines.push('');
    lines.push(`| Key | Items | Avg ms/scene | p50 | p95 | p99 | scenes/sec |`);
    lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
    for (const [k, v] of Object.entries(current.throughput)) {
      lines.push(`| ${k} | ${v.items} | ${v.avgMsPerItem.toFixed(2)} | ${v.percentiles.p50.toFixed(2)} | ${v.percentiles.p95.toFixed(2)} | ${v.percentiles.p99.toFixed(2)} | ${v.scenesPerSecond.toFixed(2)} |`);
    }
    lines.push('');

    // Memory
    lines.push(`## Memory`);
    lines.push('');
    lines.push(`| Key | Repeats | Before (MB) | After (MB) | Diff (MB) | Peak (MB) |`);
    lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
    for (const [k, v] of Object.entries(current.memory)) {
      lines.push(`| ${k} | ${v.repeats} | ${(v.beforeHeap / (1024 * 1024)).toFixed(2)} | ${(v.afterHeap / (1024 * 1024)).toFixed(2)} | ${(v.heapDiff / (1024 * 1024)).toFixed(2)} | ${(v.peakHeap / (1024 * 1024)).toFixed(2)} |`);
    }
    lines.push('');

    // UI
    if (Object.keys(current.latency).length) {
      lines.push(`## UI/Latency`);
      lines.push('');
      lines.push(`| Key | Samples | Avg (ms) | p50 | p95 | p99 |`);
      lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
      for (const [k, v] of Object.entries(current.latency)) {
        lines.push(`| ${k} | ${v.samples} | ${v.avgMs.toFixed(2)} | ${v.p50.toFixed(2)} | ${v.p95.toFixed(2)} | ${v.p99.toFixed(2)} |`);
      }
      lines.push('');
    }

    // Baseline comparison
    if (baseline) {
      lines.push(`## Baseline Comparison`);
      lines.push('');
      const comp = this.compareToBaseline(baseline);
      lines.push(`Regressions: ${comp.regressions.length ? comp.regressions.join(', ') : 'none'}`);
      lines.push(`Improvements: ${comp.improvements.length ? comp.improvements.join(', ') : 'none'}`);
      lines.push('');
      lines.push(`### Deltas`);
      lines.push('');
      lines.push(`| Metric | Delta % |`);
      lines.push(`| --- | ---: |`);
      for (const [k, v] of Object.entries(comp.deltas)) {
        lines.push(`| ${k} | ${Number(v).toFixed(2)} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // simple text utils for manuscript generation

  private countWords(text: string): number {
    return (text || '').split(/\s+/).filter(Boolean).length;
  }

  private extractCharacters(text: string): string[] {
    const set = new Set<string>();
    const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      set.add(m[1]);
    }
    return Array.from(set);
  }

  private extractTimeMarkers(text: string): string[] {
    const markers = ['Morning', 'Evening', 'Dawn', 'Dusk', 'Night', 'Afternoon', 'Noon', 'Midnight', 'next morning', 'yesterday', 'tomorrow'];
    const out: string[] = [];
    for (const k of markers) {
      const re = new RegExp(`\\b${k}\\b`, 'i');
      if (re.test(text)) out.push(k);
    }
    return out;
  }

  private extractLocationMarkers(text: string): string[] {
    const markers = ['study', 'library', 'hall', 'attic', 'kitchen', 'orchard', 'pantry', 'stairs', 'bedroom', 'window', 'door', 'desk'];
    const out: string[] = [];
    for (const k of markers) {
      const re = new RegExp(`\\b${k}\\b`, 'i');
      if (re.test(text)) out.push(k);
    }
    return out;
  }
}

export default BenchmarkHarness;