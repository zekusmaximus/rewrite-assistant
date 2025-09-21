import type { Scene, ContinuityIssue, ContinuityAnalysis, ReaderKnowledge, GlobalCoherenceAnalysis } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import AnalysisCache from '../../../../services/cache/AnalysisCache';
import BaseDetector from '../detectors/BaseDetector';
import PronounDetector from '../detectors/PronounDetector';
import TimelineDetector from '../detectors/TimelineDetector';
import CharacterDetector from '../detectors/CharacterDetector';
import PlotContextDetector from '../detectors/PlotContextDetector';
import EngagementDetector from '../detectors/EngagementDetector';
import IssueAggregator from '../detectors/IssueAggregator';

/**
 * Small tuple describing a detector entry for orchestration/testing.
 */
export interface DetectorEntry {
  readonly key: 'pronoun' | 'character' | 'timeline' | 'plot' | 'engagement';
  readonly instance: BaseDetector<any>;
}

/**
 * Pure test hook: builds an ordered detector list with fresh instances.
 * Default order: pronoun, character, timeline, plot, [engagement?].
 */
export function buildDetectorList(includeEngagement: boolean): readonly DetectorEntry[] {
  const list: DetectorEntry[] = [
    { key: 'pronoun', instance: new PronounDetector() },
    { key: 'character', instance: new CharacterDetector() },
    { key: 'timeline', instance: new TimelineDetector() },
    { key: 'plot', instance: new PlotContextDetector() },
  ];
  if (includeEngagement) list.push({ key: 'engagement', instance: new EngagementDetector() });
  return list;
}

/**
 * Pure helper: run detectors sequentially with timing and error isolation.
 * Returns a Map keyed by detector key; attaches __durations on the Map for meta.
 */
export async function runDetectorsSequential(
  scene: Scene,
  previousScenes: readonly Scene[],
  aiManager: AIServiceManager,
  detectors: readonly DetectorEntry[],
  globalContext?: GlobalCoherenceAnalysis
): Promise<Map<string, ContinuityIssue[]>> {
  const perDetector = new Map<string, ContinuityIssue[]>();
  const durations: Record<string, number> = {};
  for (const { key, instance } of detectors) {
    const started = Date.now();
    try {
      const issues = await instance.detect(scene, previousScenes, aiManager, globalContext);
      perDetector.set(key, Array.isArray(issues) ? issues : []);
      durations[key] = Date.now() - started;
      console.debug(`[ContinuityAnalyzer] ${key} finished in ${durations[key]}ms; ${issues.length} issue(s).`);
    } catch (err) {
      durations[key] = Date.now() - started;
      console.debug(`[ContinuityAnalyzer] Detector ${instance.constructor.name} failed; recorded as empty.`, err);
      perDetector.set(key, []);
    }
  }
  (perDetector as any).__durations = durations;
  return perDetector;
}

/**
 * Future-proof helper: limited-concurrency runner (max 2).
 * Not used by default; available for tuning and tests.
 */
export async function runDetectorsWithLimit(
  scene: Scene,
  previousScenes: readonly Scene[],
  aiManager: AIServiceManager,
  detectors: readonly DetectorEntry[],
  maxConcurrent = 2,
  globalContext?: GlobalCoherenceAnalysis
): Promise<Map<string, ContinuityIssue[]>> {
  const perDetector = new Map<string, ContinuityIssue[]>();
  const durations: Record<string, number> = {};
  const queue = detectors.slice();
  const runOne = async (entry: DetectorEntry) => {
    const started = Date.now();
    try {
      const issues = await entry.instance.detect(scene, previousScenes, aiManager, globalContext);
      perDetector.set(entry.key, Array.isArray(issues) ? issues : []);
      durations[entry.key] = Date.now() - started;
      console.debug(`[ContinuityAnalyzer] ${entry.key} finished in ${durations[entry.key]}ms; ${issues.length} issue(s).`);
    } catch (err) {
      durations[entry.key] = Date.now() - started;
      console.debug(`[ContinuityAnalyzer] Detector ${entry.instance.constructor.name} failed; recorded as empty.`, err);
      perDetector.set(entry.key, []);
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(maxConcurrent, queue.length); i++) {
    workers.push((async function loop() {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        await runOne(next);
      }
    })());
  }
  await Promise.all(workers);
  (perDetector as any).__durations = durations;
  return perDetector;
}

/**
 * Small helper: convert Map<string, ContinuityIssue[]> to plain Record.
 */
export function toRecord(map: Map<string, ContinuityIssue[]>): Record<string, ContinuityIssue[]> {
  const out: Record<string, ContinuityIssue[]> = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return out;
}

/**
 * Lightweight mock AI manager for unit tests.
 * resolver may return ContinuityIssue[] or { issues: ContinuityIssue[] }.
 */
export function createMockAIManager(
  resolver?: (req: Parameters<AIServiceManager['analyzeContinuity']>[0]) => any | Promise<any>
): Pick<AIServiceManager, 'analyzeContinuity'> {
  return {
    async analyzeContinuity(req: Parameters<AIServiceManager['analyzeContinuity']>[0]): Promise<Awaited<ReturnType<AIServiceManager['analyzeContinuity']>>> {
      const val = resolver ? await resolver(req) : [];
      const issues: ContinuityIssue[] = Array.isArray(val) ? val : (val?.issues ?? []);
      return {
        issues,
        metadata: {
          modelUsed: 'mock',
          provider: 'openai',
          costEstimate: 0,
          durationMs: 0,
          confidence: 0,
          cached: true,
        },
      };
    },
  } as any;
}

/**
 * Coordinates all detectors for a single scene and aggregates results.
 * Persistent detector instances preserve internal caches across calls.
 */
export default class ContinuityAnalyzer {
  private readonly pronoun = new PronounDetector();
  private readonly character = new CharacterDetector();
  private readonly timeline = new TimelineDetector();
  private readonly plot = new PlotContextDetector();
  private readonly engagement = new EngagementDetector();
  private readonly aggregator = new IssueAggregator();
  private analysisCache?: AnalysisCache;

  constructor(options?: { enableCache: boolean }) {
    if (options?.enableCache) {
      // Lazy cache creation; async init deferred until first use
      this.analysisCache = new AnalysisCache();
    }
  }

  public async analyzeScene(
    scene: Scene,
    previousScenes: readonly Scene[] | undefined,
    aiManager: AIServiceManager,
    options: { readonly includeEngagement: boolean },
    globalContext?: GlobalCoherenceAnalysis
  ): Promise<ContinuityAnalysis> {
    this.ensureValidOptions(options);
    const prev: readonly Scene[] = Array.isArray(previousScenes) ? previousScenes : [];
    const prevArr: Scene[] = [...prev] as Scene[];
    if (!scene?.text || typeof scene.text !== 'string' || scene.text.trim().length === 0) {
      return this.buildEmptyResult(scene?.id ?? 'unknown');
    }

    // Cache: lazy init and try to return early on hit
    if (this.analysisCache) {
      await this.ensureCacheInit(); // Lazy cache initialization
      try {
        // Position fallback: prefer scene.position; else scene.index; else previousScenes.length
        const positionForGet: number =
          typeof (scene as any)?.position === 'number'
            ? (scene as any).position
            : typeof (scene as any)?.index === 'number'
            ? (scene as any).index
            : prevArr.length; // fallback to number of previous scenes

        // Reader context fallback: use provided, otherwise empty typed object
        const readerContextForGet: ReaderKnowledge =
          ((options as any)?.readerContext as ReaderKnowledge) ??
          {
            knownCharacters: new Set<string>(),
            establishedTimeline: [],
            revealedPlotPoints: [],
            establishedSettings: [],
          };

        const cached = await this.analysisCache.get(scene, positionForGet, prevArr, readerContextForGet);
        if (cached) {
          return cached;
        }
      } catch (err) {
        console.debug('[ContinuityAnalyzer] cache.get failed; proceeding without cache.', err);
      }
    }

    const started = Date.now();
    const detectors = this.getPersistentDetectorList(options.includeEngagement);
    console.debug('[ContinuityAnalyzer] detectors selected:', detectors.map(d => d.key).join(','));

    const perDetector = await runDetectorsSequential(scene, prev, aiManager, detectors, globalContext);
    const aggregated = this.aggregator.aggregate(perDetector);
    const totalMs = Date.now() - started;
    const durations = (perDetector as any).__durations as Record<string, number> | undefined;

    this.logSummary(scene.id, aggregated.length, durations, totalMs);

    const result = this.buildBaseResult();
    this.attachMeta(result, scene.id, detectors.map(d => d.key), perDetector, durations, totalMs);

    // After successful analysis, best-effort write to cache
    if (this.analysisCache) {
      try {
        // Recompute position and reader context deterministically for cache set
        const positionForSet: number =
          typeof (scene as any)?.position === 'number'
            ? (scene as any).position
            : typeof (scene as any)?.index === 'number'
            ? (scene as any).index
            : prevArr.length; // fallback to number of previous scenes

        const readerContextForSet: ReaderKnowledge =
          ((options as any)?.readerContext as ReaderKnowledge) ??
          {
            knownCharacters: new Set<string>(),
            establishedTimeline: [],
            revealedPlotPoints: [],
            establishedSettings: [],
          };

        await this.analysisCache.set(scene, positionForSet, prevArr, readerContextForSet, result, totalMs);
      } catch (err) {
        console.debug('[ContinuityAnalyzer] cache.set failed; ignoring.', err);
      }
    }

    return result;
  }

  private getPersistentDetectorList(includeEngagement: boolean): readonly DetectorEntry[] {
    const list: DetectorEntry[] = [
      { key: 'pronoun', instance: this.pronoun },
      { key: 'character', instance: this.character },
      { key: 'timeline', instance: this.timeline },
      { key: 'plot', instance: this.plot },
    ];
    if (includeEngagement) list.push({ key: 'engagement', instance: this.engagement });
    return list;
  }

  // Lazy cache initialization; idempotent
  private async ensureCacheInit(): Promise<void> {
    if (!this.analysisCache) return;
    if ((this as any)._cacheInitialized) return;
    await this.analysisCache.init();
    (this as any)._cacheInitialized = true;
  }

  private ensureValidOptions(opts: { readonly includeEngagement: boolean }): void {
    if (!opts || typeof opts.includeEngagement !== 'boolean') {
      throw new Error('ContinuityAnalyzer: invalid options.includeEngagement; expected boolean');
    }
  }

  private buildBaseResult(): ContinuityAnalysis {
    const readerContext: ReaderKnowledge = {
      knownCharacters: new Set<string>(),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: [],
    };
    return {
      issues: [], // populated by meta attachment for consumers via byDetector/meta; typed shape remains minimal here
      timestamp: Date.now(),
      modelUsed: 'hybrid-local-ai',
      confidence: 0,
      readerContext,
    };
  }

  private buildEmptyResult(sceneId: string): ContinuityAnalysis {
    const res = this.buildBaseResult();
    const perDetector = new Map<string, ContinuityIssue[]>();
    this.attachMeta(res, sceneId, [], perDetector, {}, 0);
    console.debug('[ContinuityAnalyzer] empty input; returning no issues.', { sceneId });
    return res;
  }

  private attachMeta(
    result: ContinuityAnalysis,
    sceneId: string,
    detectors: readonly string[],
    perDetector: Map<string, ContinuityIssue[]>,
    durations: Record<string, number> | undefined,
    totalMs: number
  ): void {
    const byDetector = toRecord(perDetector);
    const issues = this.aggregator.aggregate(perDetector);
    const meta = {
      sceneId,
      analyzedAt: new Date().toISOString(),
      detectors: [...detectors],
      stats: {
        durationsMs: durations ?? {},
        totalMs,
      },
    };
    // Persist aggregated list into the typed field
    (result as any).issues = issues;
    // Attach raw breakdown + meta as non-enumerable properties for advanced consumers/tests
    Object.defineProperties(result as any, {
      byDetector: { value: byDetector, enumerable: false, configurable: false, writable: false },
      meta: { value: meta, enumerable: false, configurable: false, writable: false },
    });
  }

  private logSummary(
    sceneId: string,
    finalCount: number,
    durations: Record<string, number> | undefined,
    totalMs: number
  ): void {
    const policy = finalCount > 10 ? 'mustfix_overflow' : 'top10';
    console.debug('[ContinuityAnalyzer] aggregate complete:', {
      sceneId,
      issues: finalCount,
      limitPolicy: policy,
      durationsMs: durations ?? {},
      totalMs,
    });
  }
}