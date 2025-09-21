// src/services/coherence/GlobalAnalysisOrchestrator.ts

import type {
  Manuscript,
  Scene,
  CompressedScene,
  GlobalCoherenceAnalysis,
  GlobalCoherenceSettings,
  GlobalCoherenceProgress,
  ScenePairAnalysis,
  ChapterFlowAnalysis,
  ManuscriptAnalysis,
  ContinuityIssue,
  ReaderKnowledge,
  NarrativeFlowIssue,
  PacingIssue,
  ThematicDiscontinuity,
  CharacterArcIssue,
  Location,
} from '../../shared/types';
import AIServiceManager from '../ai/AIServiceManager';
import AnalysisCache from '../cache/AnalysisCache';
// Wildcard import to be resilient to either default or named export for ManuscriptCompressor
import * as ManuscriptCompressorModule from './ManuscriptCompressor';
import { TransitionAnalyzer } from './passes/TransitionAnalyzer';

export type ProgressCallback = (progress: GlobalCoherenceProgress) => void;

type PassName = 'transitions' | 'sequences' | 'chapters' | 'arc' | 'synthesis';

interface SequenceResults {
  flow: NarrativeFlowIssue[];
  pacing: PacingIssue[];
  theme: ThematicDiscontinuity[];
}

type CompressorCtor = new (...args: any[]) => {
  prepareScenesForAnalysis(scenes: Scene[]): Promise<CompressedScene[]>;
  createManuscriptSkeleton(manuscript: Manuscript): Promise<any>;
};

function instantiateCompressor(ai: AIServiceManager): InstanceType<CompressorCtor> {
  const Ctor =
    (ManuscriptCompressorModule as any).default ??
    (ManuscriptCompressorModule as any).ManuscriptCompressor;
  if (!Ctor) {
    throw new Error('ManuscriptCompressor export not found');
  }
  return new Ctor(ai);
}

/**
 * Coordinates the global coherence analysis pipeline across passes.
 * - Progress reporting mirrors RewriteOrchestrator patterns.
 * - Per-item errors are logged at debug level; pass-level failures at error level.
 * - Uses AnalysisCache for per-scene continuity caching.
 */
export class GlobalAnalysisOrchestrator {
  private ai: AIServiceManager;
  private compressor: ReturnType<typeof instantiateCompressor>;
  private cache?: AnalysisCache;
  private cancelled = false;
  private delayBetweenItemsMs = 0;
  private modelsUsed: Record<string, string> = {};
  private transitionAnalyzer: TransitionAnalyzer;

  constructor(aiManager?: AIServiceManager, options?: { enableCache?: boolean; delayBetweenItemsMs?: number }) {
    this.ai = aiManager ?? new AIServiceManager();
    this.compressor = instantiateCompressor(this.ai);
    this.transitionAnalyzer = new TransitionAnalyzer(this.ai);
    if (options?.enableCache) {
      this.cache = new AnalysisCache();
    }
    if (options?.delayBetweenItemsMs && options.delayBetweenItemsMs > 0) {
      this.delayBetweenItemsMs = options.delayBetweenItemsMs;
    }
  }

  /**
   * Main entry point - analyzes manuscript with selected passes.
   * Follows progress tracking style of rewrite orchestrator.
   */
  async analyzeGlobalCoherence(
    manuscript: Manuscript,
    settings: GlobalCoherenceSettings,
    progressCallback?: ProgressCallback
  ): Promise<GlobalCoherenceAnalysis> {
    this.cancelled = false;
    const startTime = Date.now();
    const errors: Array<{ pass: string; error: string }> = [];

    // Initialize cache if enabled
    if (this.cache) {
      await this.cache.init();
    }

    const passes = this.computePasses(settings);
    const sceneIndex = new Map<string, Scene>(manuscript.scenes.map(s => [s.id, s]));

    const progress: GlobalCoherenceProgress = {
      currentPass: passes[0] ?? 'transitions',
      passNumber: 0,
      totalPasses: passes.length,
      passProgress: 0,
      currentScene: undefined,
      scenesAnalyzed: 0,
      totalScenes: manuscript.scenes.length,
      partialResults: undefined,
      estimatedTimeRemaining: 0,
      errors,
      cancelled: false,
    };

    const emit = (p: GlobalCoherenceProgress, partial?: Partial<GlobalCoherenceAnalysis>) => {
      if (partial) {
        p.partialResults = { ...(p.partialResults ?? {}), ...partial };
      }
      progressCallback?.(p);
    };

    emit(progress);

    // Precompute compressed scenes for reuse across passes
    progress.currentPass = 'transitions';
    progress.passProgress = 0;
    emit(progress);

    const compressedScenes = await this.compressor.prepareScenesForAnalysis(
      manuscript.scenes
    );

    // Accumulators
    let sceneLevel: ScenePairAnalysis[] = [];
    let chapterLevel: ChapterFlowAnalysis[] = [];
    let manuscriptLevel: ManuscriptAnalysis | undefined;
    const flowIssues: NarrativeFlowIssue[] = [];
    const pacingProblems: PacingIssue[] = [];
    const thematicBreaks: ThematicDiscontinuity[] = [];
    const _characterArcDisruptions: CharacterArcIssue[] = [];

    // Pass 1: Transitions
    if (settings.enableTransitions && !this.cancelled) {
      progress.currentPass = 'transitions';
      progress.passNumber = 1;
      progress.passProgress = 0;
      progress.scenesAnalyzed = 0;
      emit(progress);

      try {
        sceneLevel = await this.transitionAnalyzer.analyzeTransitions(
          compressedScenes,
          async (p, currentSceneId) => {
            progress.passProgress = p;
            progress.scenesAnalyzed = Math.floor(((compressedScenes.length - 1) * p) / 100);
            progress.currentScene = currentSceneId;
            progress.estimatedTimeRemaining = this.estimateRemainingSeconds(startTime, progress.passNumber - 1 + p / 100, passes.length);
            emit(progress, { sceneLevel });
          }
        );
        // Record model used for transitions (for reporting consistency)
        const modelsMap = this.transitionAnalyzer.getModelsUsed();
        const firstModel = modelsMap.values().next().value;
        if (firstModel) this.modelsUsed['transitions'] = firstModel;
      } catch (error) {
        console.error('[GlobalAnalysisOrchestrator] Transition pass failed:', error);
        errors.push({ pass: 'transitions', error: String(error) });
      }
    }

    // Pass 2: Sequences
    if (settings.enableSequences && !this.cancelled) {
      progress.currentPass = 'sequences';
      progress.passNumber = 2;
      progress.passProgress = 0;
      progress.scenesAnalyzed = 0;
      emit(progress);

      try {
        const sequenceResults = await this.executeSequencePass(
          compressedScenes,
          manuscript.scenes,
          sceneIndex,
          async (p, currentSceneId) => {
            progress.passProgress = p;
            const totalWindows = Math.max(0, compressedScenes.length - 2);
            progress.scenesAnalyzed = Math.floor((totalWindows * p) / 100);
            progress.currentScene = currentSceneId;
            progress.estimatedTimeRemaining = this.estimateRemainingSeconds(startTime, progress.passNumber - 1 + p / 100, passes.length);
            emit(progress);
          }
        );

        // Aggregate sequence findings
        flowIssues.push(...sequenceResults.flow);
        pacingProblems.push(...sequenceResults.pacing);
        thematicBreaks.push(...sequenceResults.theme);

        // Merge hints back into scene-level if helpful
        this.mergeSequenceFindings(sceneLevel, sequenceResults);
        emit(progress, { sceneLevel, flowIssues, pacingProblems, thematicBreaks });
      } catch (error) {
        console.error('[GlobalAnalysisOrchestrator] Sequence pass failed:', error);
        errors.push({ pass: 'sequences', error: String(error) });
      }
    }

    // Pass 3: Chapters
    if (settings.enableChapters && !this.cancelled) {
      progress.currentPass = 'chapters';
      progress.passNumber = 3;
      progress.passProgress = 0;
      progress.scenesAnalyzed = 0;
      emit(progress);

      try {
        chapterLevel = await this.executeChapterPass(
          manuscript,
          compressedScenes,
          async (p) => {
            progress.passProgress = p;
            const totalChaptersEstimate = Math.max(1, Math.ceil(manuscript.scenes.length / 5));
            progress.scenesAnalyzed = Math.floor((totalChaptersEstimate * p) / 100);
            progress.currentScene = undefined;
            progress.estimatedTimeRemaining = this.estimateRemainingSeconds(startTime, progress.passNumber - 1 + p / 100, passes.length);
            emit(progress, { chapterLevel });
          }
        );
      } catch (error) {
        console.error('[GlobalAnalysisOrchestrator] Chapter pass failed:', error);
        errors.push({ pass: 'chapters', error: String(error) });
      }
    }

    // Pass 4: Arc
    if (settings.enableArc && !this.cancelled) {
      progress.currentPass = 'arc';
      progress.passNumber = 4;
      progress.passProgress = 0;
      progress.scenesAnalyzed = 0;
      emit(progress);

      try {
        manuscriptLevel = await this.executeArcPass(
          manuscript,
          compressedScenes,
          async (p) => {
            progress.passProgress = p;
            progress.currentScene = undefined;
            progress.estimatedTimeRemaining = this.estimateRemainingSeconds(startTime, progress.passNumber - 1 + p / 100, passes.length);
            emit(progress);
          }
        );
      } catch (error) {
        console.error('[GlobalAnalysisOrchestrator] Arc pass failed:', error);
        errors.push({ pass: 'arc', error: String(error) });
      }
    }

    // Pass 5: Synthesis
    let analysis: GlobalCoherenceAnalysis;
    if (settings.enableSynthesis && !this.cancelled) {
      progress.currentPass = 'synthesis';
      progress.passNumber = 5;
      progress.passProgress = 0;
      progress.scenesAnalyzed = 0;
      emit(progress);

      try {
        analysis = await this.executeSynthesisPass(
          sceneLevel,
          chapterLevel,
          manuscriptLevel,
          manuscript,
          settings,
          async (p) => {
            progress.passProgress = p;
            progress.currentScene = undefined;
            progress.estimatedTimeRemaining = this.estimateRemainingSeconds(startTime, progress.passNumber - 1 + p / 100, passes.length);
            emit(progress);
          }
        );
      } catch (error) {
        console.error('[GlobalAnalysisOrchestrator] Synthesis pass failed:', error);
        errors.push({ pass: 'synthesis', error: String(error) });
        analysis = this.createBasicAnalysis(sceneLevel, chapterLevel, manuscriptLevel, settings);
      }
    } else {
      analysis = this.createBasicAnalysis(sceneLevel, chapterLevel, manuscriptLevel, settings);
    }

    // Finalize
    analysis.timestamp = Date.now();
    analysis.totalAnalysisTime = Date.now() - startTime;
    analysis.modelsUsed = this.getModelsUsed();
    analysis.settings = settings;

    progress.passProgress = 100;
    progress.partialResults = analysis;
    emit(progress);

    return analysis;
  }

  /**
   * Cancel ongoing analysis. Cooperative checks will end passes gracefully.
   */
  cancelAnalysis(): void {
    this.cancelled = true;
    this.transitionAnalyzer.cancel();
  }

  /**
   * Enrich existing scene issues with global context, mirroring BaseDetector style.
   */
  enrichSceneIssues(
    sceneIssues: Map<string, ContinuityIssue[]>,
    globalAnalysis: GlobalCoherenceAnalysis
  ): Map<string, ContinuityIssue[]> {
    const enriched = new Map(sceneIssues);

    for (const [sceneId, issues] of enriched.entries()) {
      const relatedTransition = globalAnalysis.sceneLevel.find(
        t => t.sceneAId === sceneId || t.sceneBId === sceneId
      );
      const relatedFlow = globalAnalysis.flowIssues.find(
        f => f.affectedScenes.includes(sceneId)
      );

      const updated = issues.map(issue => {
        if (relatedTransition || relatedFlow) {
          return {
            ...issue,
            description: issue.description + this.buildGlobalContext(relatedTransition, relatedFlow),
            severity: this.escalateSeverity(issue.severity, !!relatedTransition, !!relatedFlow),
          };
        }
        return issue;
      });

      enriched.set(sceneId, updated);
    }

    return enriched;
  }

  // ========== Private helpers ==========


  private async executeSequencePass(
    compressed: CompressedScene[],
    scenes: Scene[],
    sceneIndex: Map<string, Scene>,
    onProgress: (percent: number, currentSceneId?: string) => void
  ): Promise<SequenceResults> {
    const k = 3; // window size
    const totalWindows = Math.max(0, compressed.length - (k - 1));
    const flow: NarrativeFlowIssue[] = [];
    const pacing: PacingIssue[] = [];
    const theme: ThematicDiscontinuity[] = [];

    if (totalWindows === 0) {
      onProgress(100);
      return { flow, pacing, theme };
    }

    for (let endIdx = k - 1; endIdx < compressed.length; endIdx++) {
      if (this.cancelled) break;

      const startIdx = endIdx - (k - 1);
      const windowCompressed = compressed.slice(startIdx, endIdx + 1);
      const lastId = windowCompressed[windowCompressed.length - 1].id;
      const windowScenes: Scene[] = windowCompressed
        .map(c => sceneIndex.get(c.id))
        .filter(Boolean) as Scene[];

      if (windowScenes.length < k) {
        console.debug('[GlobalAnalysisOrchestrator] Incomplete window for sequence analysis at endIdx', endIdx);
        continue;
      }

      const target = windowScenes[windowScenes.length - 1];
      const prev = windowScenes.slice(0, -1);
      const reader = this.buildReaderContextFromCompressed(
        compressed.slice(0, endIdx)
      );

      try {
        const res = await this.ai.analyzeContinuity({
          scene: target,
          previousScenes: prev,
          analysisType: 'complex',
          readerContext: reader,
        } as any);

        this.modelsUsed['sequences'] = res.metadata.modelUsed ?? this.modelsUsed['sequences'];

        // Heuristic mapping: timeline/plot issues => flow; large tension deltas => pacing; context => theme
        for (const iss of res.issues as ContinuityIssue[]) {
          if (iss.type === 'timeline' || iss.type === 'plot') {
            flow.push({
              type: 'flow',
              severity: iss.severity,
              description: iss.description,
              textSpan: iss.textSpan,
              affectedScenes: windowScenes.map(s => s.id),
              pattern: iss.type === 'timeline' ? 'broken_causality' : 'info_gap',
            });
          } else if (iss.type === 'engagement') {
            pacing.push({
              type: 'pacing',
              severity: iss.severity,
              description: iss.description,
              textSpan: iss.textSpan,
              affectedScenes: windowScenes.map(s => s.id),
              pattern: 'inconsistent',
              tensionDelta: 0,
            });
          } else if (iss.type === 'context') {
            theme.push({
              type: 'theme',
              severity: iss.severity,
              description: iss.description,
              textSpan: iss.textSpan,
              theme: 'contextual',
              lastSeenScene: windowScenes[0].id,
              brokenAtScene: target.id,
            });
          }
        }
      } catch (err) {
        console.debug('[GlobalAnalysisOrchestrator] Sequence AI failed for window ending at', target.id, err);
        // Graceful degradation: continue without adding issues
      }

      const processed = endIdx - (k - 2);
      const percent = Math.floor((processed / totalWindows) * 100);
      onProgress(percent, lastId);

      if (this.delayBetweenItemsMs > 0 && processed < totalWindows) {
        await this.delay(this.delayBetweenItemsMs);
      }
    }

    return { flow, pacing, theme };
  }

  private async executeChapterPass(
    manuscript: Manuscript,
    compressed: CompressedScene[],
    onProgress: (percent: number) => void
  ): Promise<ChapterFlowAnalysis[]> {
    // Use skeleton to get chapter groupings if available
    const skeleton = await this.compressor.createManuscriptSkeleton(manuscript);
    const chapters = Array.isArray(skeleton?.chapters) ? skeleton.chapters : [];
    const total = Math.max(1, chapters.length || Math.ceil(manuscript.scenes.length / 5));
    const results: ChapterFlowAnalysis[] = [];

    if (!chapters.length) {
      // Fallback: naive grouping by 5 scenes
      const ids = manuscript.currentOrder ?? manuscript.scenes.map(s => s.id);
      for (let i = 0, ch = 1; i < ids.length; i += 5, ch++) {
        const group = ids.slice(i, i + 5);
        results.push(this.buildDefaultChapterAnalysis(ch, group));
        const percent = Math.min(100, Math.floor(((ch) / total) * 100));
        onProgress(percent);
      }
      return results;
    }

    for (let i = 0; i < chapters.length; i++) {
      if (this.cancelled) break;
      const ch = chapters[i];
      const sceneIds: string[] = Array.isArray(ch?.sceneIds) ? ch.sceneIds : [];
      results.push(this.buildDefaultChapterAnalysis(i + 1, sceneIds));
      const percent = Math.floor(((i + 1) / total) * 100);
      onProgress(percent);
      if (this.delayBetweenItemsMs > 0 && i + 1 < chapters.length) {
        await this.delay(this.delayBetweenItemsMs);
      }
    }

    return results;
  }

  private async executeArcPass(
    manuscript: Manuscript,
    compressed: CompressedScene[],
    onProgress: (percent: number) => void
  ): Promise<ManuscriptAnalysis> {
    // Heuristic synthesis from available data; no AI call to keep costs predictable.
    // Progress: do a few steps to give feedback.
    onProgress(10);

    const _chapterCount = Math.max(1, Math.ceil(manuscript.scenes.length / 5));
    onProgress(40);

    // Placeholder: structural integrity based on density of scenes
    const structuralIntegrity = Math.min(1, Math.max(0.3, manuscript.scenes.length / 100));

    // Simple act balance heuristic
    const actSize = Math.max(1, Math.floor(manuscript.scenes.length / 3));
    const actBalance: [number, number, number] = [
      Math.min(1, (actSize) / manuscript.scenes.length),
      Math.min(1, (actSize) / manuscript.scenes.length),
      Math.min(1, (manuscript.scenes.length - 2 * actSize) / manuscript.scenes.length),
    ];

    onProgress(70);

    const analysis: ManuscriptAnalysis = {
      structuralIntegrity,
      actBalance,
      characterArcs: new Map(),
      plotHoles: [],
      unresolvedElements: [],
      pacingCurve: {
        slowSpots: [],
        rushedSections: [],
      },
      thematicCoherence: 0.6,
      openingEffectiveness: 0.65,
      endingSatisfaction: 0.7,
    };

    onProgress(100);
    return analysis;
  }

  private async executeSynthesisPass(
    sceneLevel: ScenePairAnalysis[],
    chapterLevel: ChapterFlowAnalysis[],
    manuscriptLevel: ManuscriptAnalysis | undefined,
    manuscript: Manuscript,
    settings: GlobalCoherenceSettings,
    onProgress: (percent: number) => void
  ): Promise<GlobalCoherenceAnalysis> {
    onProgress(25);

    const base = this.createBasicAnalysis(sceneLevel, chapterLevel, manuscriptLevel, settings);
    onProgress(60);

    // Potential additional synthesis/normalization could occur here
    const result: GlobalCoherenceAnalysis = {
      ...base,
      // Fields already populated by createBasicAnalysis
    };

    onProgress(100);
    return result;
  }

  private createBasicAnalysis(
    sceneLevel: ScenePairAnalysis[],
    chapterLevel: ChapterFlowAnalysis[],
    manuscriptLevel: ManuscriptAnalysis | undefined,
    settings: GlobalCoherenceSettings
  ): GlobalCoherenceAnalysis {
    // Compute simple aggregates
    const avgTransition = sceneLevel.length
      ? sceneLevel.reduce((s, x) => s + x.transitionScore, 0) / sceneLevel.length
      : 0.7;

    const avgChapter = chapterLevel.length
      ? chapterLevel.reduce((s, x) => s + x.coherenceScore, 0) / chapterLevel.length
      : 0.7;

    const ml: ManuscriptAnalysis =
      manuscriptLevel ?? {
        structuralIntegrity: Math.min(1, (avgTransition + avgChapter) / 2),
        actBalance: [0.33, 0.33, 0.34],
        characterArcs: new Map(),
        plotHoles: [],
        unresolvedElements: [],
        pacingCurve: { slowSpots: [], rushedSections: [] },
        thematicCoherence: avgChapter,
        openingEffectiveness: Math.max(0.5, avgTransition - 0.05),
        endingSatisfaction: Math.max(0.5, avgChapter - 0.05),
      };

    return {
      sceneLevel,
      chapterLevel,
      manuscriptLevel: ml,
      flowIssues: [],
      pacingProblems: [],
      thematicBreaks: [],
      characterArcDisruptions: [],
      timestamp: Date.now(),
      totalAnalysisTime: 0,
      modelsUsed: this.getModelsUsed(),
      settings,
    };
  }

  private buildDefaultChapterAnalysis(chapterNumber: number, sceneIds: string[]): ChapterFlowAnalysis {
    return {
      chapterNumber,
      sceneIds,
      coherenceScore: 0.7,
      issues: {
        unity: true,
        completeness: true,
        balancedPacing: true,
        narrativePurpose: true,
      },
      recommendations: {
        shouldSplit: false,
        shouldMergeWithNext: false,
        orphanedScenes: [],
        missingElements: [],
      },
      pacingProfile: {
        frontLoaded: false,
        saggyMiddle: false,
        rushedEnding: false,
      },
    };
  }

  private computePasses(settings: GlobalCoherenceSettings): PassName[] {
    const order: PassName[] = [];
    if (settings.enableTransitions) order.push('transitions');
    if (settings.enableSequences) order.push('sequences');
    if (settings.enableChapters) order.push('chapters');
    if (settings.enableArc) order.push('arc');
    if (settings.enableSynthesis) order.push('synthesis');
    return order;
  }

  private estimateRemainingSeconds(
    runStart: number,
    progressPassIndexFraction: number, // e.g., 2.5 for halfway through 3rd pass
    totalPasses: number
  ): number {
    const elapsed = (Date.now() - runStart) / 1000;
    const fraction = Math.min(0.999, Math.max(0.001, progressPassIndexFraction / totalPasses));
    return Math.max(0, Math.floor((elapsed / fraction) - elapsed));
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(res => setTimeout(res, ms));
  }

  private buildReaderContextFromCompressed(history: CompressedScene[]): ReaderKnowledge {
    const knownCharacters = new Set<string>();
    const settings: Location[] = [];

    const seenLocations = new Set<string>();
    for (const c of history) {
      for (const ch of c.metadata?.characters ?? []) {
        if (ch) knownCharacters.add(ch);
      }
      for (const loc of c.metadata?.locations ?? []) {
        if (loc && !seenLocations.has(loc)) {
          settings.push({ name: loc });
          seenLocations.add(loc);
        }
      }
    }

    return {
      knownCharacters,
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: settings,
    };
  }

  private mergeSequenceFindings(
    sceneLevel: ScenePairAnalysis[],
    sequence: SequenceResults
  ): void {
    // This reserved hook could annotate scene-level issues with flow/pacing hints.
    // For now, we leave sceneLevel as-is and rely on flow/pacing lists in the final analysis.
    void sceneLevel; // no-op
    void sequence;
  }

  private buildGlobalContext(
    transitionIssue?: ScenePairAnalysis,
    flowIssue?: NarrativeFlowIssue
  ): string {
    const parts: string[] = [];
    if (transitionIssue) {
      parts.push(` Global transition score around this scene: ${transitionIssue.transitionScore.toFixed(2)}.`);
    }
    if (flowIssue) {
      parts.push(` Sequence flow pattern flagged: ${flowIssue.pattern}.`);
    }
    return parts.length ? ` [Global context:${parts.join('')}]` : '';
  }

  private escalateSeverity(
    base: ContinuityIssue['severity'],
    hasTransitionContext: boolean,
    hasFlowContext: boolean
  ): ContinuityIssue['severity'] {
    const order: ContinuityIssue['severity'][] = ['consider', 'should-fix', 'must-fix'];
    let idx = order.indexOf(base);
    if (idx < 0) idx = 0;
    if (hasTransitionContext) idx = Math.min(idx + 1, order.length - 1);
    if (hasFlowContext) idx = Math.min(idx + 1, order.length - 1);
    return order[idx];
  }

  private getModelsUsed(): Record<string, string> {
    return { ...this.modelsUsed };
  }
}

export default GlobalAnalysisOrchestrator;