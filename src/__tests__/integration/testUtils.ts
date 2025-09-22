import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { expect } from 'vitest';
import AIServiceManager from '../../services/ai/AIServiceManager';
import ManuscriptExporter from '../../services/export/ManuscriptExporter';
import ContinuityAnalyzer from '../../renderer/features/analyze/services/ContinuityAnalyzer';
import { useManuscriptStore } from '../../renderer/stores/manuscriptStore';
import { useHistoryStore } from '../../renderer/stores/historyStore';
import type {
  Manuscript,
  Scene,
  ContinuityIssue,
  ContinuityAnalysis,
  RewriteVersion
} from '../../shared/types';

// -------------------------------
// File/Fixture Utilities
// -------------------------------

const FIXTURES_DIR = path.join(process.cwd(), 'src', 'tests', 'fixtures');

function countWords(text: string): number {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

function extractCharacters(text: string): string[] {
  // naive proper-noun extractor
  const set = new Set<string>();
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    set.add(m[1]);
  }
  return Array.from(set);
}

function extractTimeMarkers(text: string): string[] {
  const markers = ['Morning', 'Evening', 'Dawn', 'Dusk', 'Night', 'Afternoon', 'Noon', 'Midnight', 'next morning', 'yesterday', 'tomorrow'];
  const out: string[] = [];
  for (const k of markers) {
    const re = new RegExp(`\\b${k}\\b`, 'i');
    if (re.test(text)) out.push(k);
  }
  return out;
}

function extractLocationMarkers(text: string): string[] {
  const markers = ['study', 'library', 'hall', 'attic', 'kitchen', 'orchard', 'pantry', 'stairs', 'bedroom', 'window', 'door', 'desk'];
  const out: string[] = [];
  for (const k of markers) {
    const re = new RegExp(`\\b${k}\\b`, 'i');
    if (re.test(text)) out.push(k);
  }
  return out;
}

// Split manuscript by "Chapter N" headers into scene texts
function splitIntoScenes(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const indices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Chapter\s+\d+/i.test(lines[i])) {
      indices.push(i);
    }
  }
  if (indices.length === 0) {
    // Fallback: split on 2+ newlines
    return raw.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  }
  const scenes: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : lines.length;
    const chunk = lines.slice(start, end).join('\n').trim();
    if (chunk) scenes.push(chunk);
  }
  return scenes;
}

export async function loadTestManuscript(filename: string): Promise<Manuscript> {
  const filePath = path.join(FIXTURES_DIR, filename);
  const raw = await fs.readFile(filePath, 'utf-8');
  const sceneTexts = splitIntoScenes(raw);

  const scenes: Scene[] = sceneTexts.map((text, idx) => {
    const chars = extractCharacters(text);
    const timeMarkers = extractTimeMarkers(text);
    const locationMarkers = extractLocationMarkers(text);
    return {
      id: `s${idx + 1}`,
      text,
      wordCount: countWords(text),
      position: idx,
      originalPosition: idx,
      characters: chars,
      timeMarkers,
      locationMarkers,
      hasBeenMoved: false,
      rewriteStatus: 'pending'
    } as Scene;
  });

  const manuscript: Manuscript = {
    id: `m-${path.parse(filename).name}`,
    title: path.parse(filename).name,
    scenes,
    originalOrder: scenes.map(s => s.id),
    currentOrder: scenes.map(s => s.id),
    filePath
  };

  // Initialize store state for integration flows
  useManuscriptStore.getState().setManuscript(manuscript);

  return manuscript;
}

// -------------------------------
// AI Test Double
// -------------------------------

/**
 * Deterministic AI manager for integration tests.
 * - For analysis (non-rewrite): returns empty issues quickly.
 * - For rewrite: returns a minimally adjusted text that "clarifies" early pronouns by replacing
 *   sentence-initial "She " with the first known character if available, otherwise with "Alice ".
 *   Also echoes metadata for timing/cost.
 * - Can be configured to throw for specific scene ids to simulate partial failures.
 */
export class TestAIManager extends AIServiceManager {
  private failScenes = new Set<string>();
  private latencyMs: number;

  constructor(opts?: { failScenes?: string[]; latencyMs?: number }) {
    super();
    if (opts?.failScenes) opts.failScenes.forEach(id => this.failScenes.add(id));
    this.latencyMs = Math.max(0, opts?.latencyMs ?? 0);
  }

  public setFailures(ids: string[]) {
    this.failScenes = new Set(ids);
  }

  async analyzeContinuity(req: any): Promise<any> {
    const sceneId: string = String(req?.scene?.id ?? '');
    if (this.failScenes.has(sceneId)) {
      throw new Error(`Simulated AI failure for ${sceneId}`);
    }
    if (this.latencyMs > 0) {
      await new Promise(r => setTimeout(r, this.latencyMs));
    }

    const isRewrite = !!req?.isRewriteRequest;
    if (isRewrite) {
      const known = Array.from((req?.readerContext?.knownCharacters ?? new Set<string>()) as Set<string>);
      const preferred = known[0] || 'Alice';
      const original: string = String(req?.scene?.text ?? '');
      // naive "clarification" for leading 'She ' or 'she '
      const rewritten = original.replace(/\b([Ss])he\b/g, (_m: string, p1: string) => (p1 === 'S' ? preferred : preferred.toLowerCase()));
      return {
        rewrittenText: rewritten,
        metadata: {
          modelUsed: 'test-double',
          provider: 'mock',
          costEstimate: 0,
          durationMs: this.latencyMs,
          confidence: 0.95,
          cached: false
        }
      };
    }

    // Non-rewrite: return empty issues
    return {
      issues: [],
      metadata: {
        modelUsed: 'test-double',
        provider: 'mock',
        costEstimate: 0,
        durationMs: this.latencyMs,
        confidence: 0.8,
        cached: false
      }
    };
  }
}

// -------------------------------
// Analysis Utilities
// -------------------------------

export interface AnalysisResult {
  byScene: Map<string, ContinuityAnalysis>;
  totalIssues: number;
  totalScenes: number;
}

export async function analyzeManuscript(
  manuscript: Manuscript,
  ai: AIServiceManager,
  opts?: { includeEngagement?: boolean; abortSignal?: AbortSignal; onProgress?: (n: number, total: number) => void }
): Promise<AnalysisResult> {
  const analyzer = new ContinuityAnalyzer({ enableCache: true });
  const includeEngagement = !!opts?.includeEngagement;
  const byScene = new Map<string, ContinuityAnalysis>();
  let totalIssues = 0;

  const ordered = manuscript.currentOrder.map(id => manuscript.scenes.find(s => s.id === id)!).filter(Boolean) as Scene[];
  for (let i = 0; i < ordered.length; i++) {
    if (opts?.abortSignal?.aborted) break;
    const scene = ordered[i];
    const prev = ordered.slice(0, i);
    const res = await analyzer.analyzeScene(scene, prev, ai, { includeEngagement });
    byScene.set(scene.id, res);
    totalIssues += (res.issues?.length ?? 0);
    // Persist into store scene for subsequent rewrite stage
    useManuscriptStore.getState().updateScene(scene.id, { continuityAnalysis: res });
    opts?.onProgress?.(i + 1, ordered.length);
  }

  return { byScene, totalIssues, totalScenes: ordered.length };
}

// -------------------------------
// Reorder Simulation
// -------------------------------

export async function simulateReorder(scenes: Scene[], newOrder: number[]): Promise<Scene[]> {
  const reordered = newOrder.map((pos, idx) => ({ scene: scenes[idx], newPos: pos }))
    .sort((a, b) => a.newPos - b.newPos)
    .map((e, i) => ({ ...e.scene, position: i, hasBeenMoved: i !== e.scene.originalPosition }));

  return reordered;
}

export function applyReorderToStore(newOrderSceneIds: string[]): void {
  const ms = useManuscriptStore.getState().manuscript;
  if (!ms) throw new Error('No manuscript in store');
  useManuscriptStore.getState().reorderScenes(newOrderSceneIds);
}

// -------------------------------
// Export Utilities
// -------------------------------

export interface ExportExpectations {
  format?: 'original' | 'rewritten' | 'both' | 'changelog';
  contains?: string[];
  totalScenes?: number;
  rewrittenScenesAtLeast?: number;
}

export async function assertExportValid(exportPath: string, expectations: ExportExpectations): Promise<void> {
  const content = await fs.readFile(exportPath, 'utf-8');
  if (expectations.contains) {
    for (const needle of expectations.contains) {
      expect(content).toContain(needle);
    }
  }
}

export async function exportWith(
  manuscript: Manuscript,
  rewrites: Map<string, RewriteVersion[]>,
  options: Parameters<ManuscriptExporter['exportManuscript']>[2]
): Promise<{ resultPath: string; content: string; stats: NonNullable<ReturnType<ManuscriptExporter['exportManuscript']> extends Promise<infer R> ? R : never>['stats'] }> {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rewrite-e2e-'));
  const exporter = new ManuscriptExporter();
  const result = await exporter.exportManuscript(manuscript, rewrites, { ...options, outputPath: outDir, filename: options.filename ?? 'out.txt' });
  expect(result.success).toBe(true);
  expect(result.filePath).toBeTruthy();
  const content = await fs.readFile(result.filePath!, 'utf-8');
  return { resultPath: result.filePath!, content, stats: result.stats! };
}

// -------------------------------
// Performance Monitor
// -------------------------------

export class PerformanceMonitor {
  private starts = new Map<string, bigint>();
  private durations = new Map<string, number>();

  startMeasurement(label: string): void {
    this.starts.set(label, process.hrtime.bigint());
  }

  endMeasurement(label: string): number {
    const start = this.starts.get(label);
    if (!start) return 0;
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;
    this.durations.set(label, ms);
    return ms;
  }

  assertUnderThreshold(label: string, maxMs: number): void {
    const dur = this.durations.get(label);
    expect(dur).toBeDefined();
    expect(dur!).toBeLessThanOrEqual(maxMs);
  }
}

// -------------------------------
// Helpers for rewrite results mapping
// -------------------------------

export function toRewriteMapFromBatch(progress: { results: Map<string, any> }): Map<string, RewriteVersion[]> {
  const m = new Map<string, RewriteVersion[]>();
  for (const [sceneId, res] of progress.results.entries()) {
    const v: RewriteVersion = {
      id: `rw-${sceneId}`,
      sceneId,
      timestamp: Date.now(),
      rewrittenText: String(res?.rewrittenText ?? ''),
      issuesAddressed: (res?.issuesAddressed ?? []) as ContinuityIssue[],
      changesExplanation: String(res?.changesExplanation ?? ''),
      modelUsed: String(res?.modelUsed ?? 'test-double'),
      userEdited: false,
      appliedToManuscript: false
    };
    m.set(sceneId, [v]);
  }
  return m;
}

// -------------------------------
// Store Reset Utilities
// -------------------------------

export function resetStores(): void {
  useManuscriptStore.getState().clearManuscript();
  useHistoryStore.getState().clearHistory();
}