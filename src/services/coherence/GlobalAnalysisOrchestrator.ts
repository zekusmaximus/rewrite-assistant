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
import { MissingKeyError, InvalidKeyError } from '../ai/errors/AIServiceErrors';
import AnalysisCache from '../cache/AnalysisCache';
import { ManuscriptCompressor } from './ManuscriptCompressor';
import { TransitionAnalyzer } from './passes/TransitionAnalyzer';
import { SequenceAnalyzer } from './passes/SequenceAnalyzer';
import { ChapterAnalyzer } from './passes/ChapterAnalyzer';
import { ArcValidator } from './passes/ArcValidator';
import { SynthesisEngine } from './passes/SynthesisEngine';

export type ProgressCallback = (progress: GlobalCoherenceProgress) => void;

type PassName = 'transitions' | 'sequences' | 'chapters' | 'arc' | 'synthesis';

interface SequenceResults {
  flow: NarrativeFlowIssue[];
  pacing: PacingIssue[];
  theme: ThematicDiscontinuity[];
}


/**
 * Coordinates the global coherence analysis pipeline across passes.
 * - Progress reporting mirrors RewriteOrchestrator patterns.
 * - Per-item errors are logged at debug level; pass-level failures at error level.
 * - Uses AnalysisCache for per-scene continuity caching.
 */
export class GlobalAnalysisOrchestrator {
  private ai: AIServiceManager;
  private compressor: ManuscriptCompressor;
  private cache?: AnalysisCache;
  private cancelled = false;
  private delayBetweenItemsMs = 0;
  private modelsUsed: Record<string, string> = {};
  private transitionAnalyzer: TransitionAnalyzer;
  private sequenceAnalyzer: SequenceAnalyzer;
  private chapterAnalyzer: ChapterAnalyzer;
  private arcValidator: ArcValidator;
  private synthesisEngine: SynthesisEngine;

  constructor(aiManager?: AIServiceManager, options?: { enableCache?: boolean; delayBetweenItemsMs?: number }) {
    this.ai = aiManager ?? new AIServiceManager();
    this.compressor = new ManuscriptCompressor(this.ai);
    this.transitionAnalyzer = new TransitionAnalyzer(this.ai);
    this.sequenceAnalyzer = new SequenceAnalyzer(this.ai);
    this.chapterAnalyzer = new ChapterAnalyzer(this.ai);
    this.arcValidator = new ArcValidator(this.ai);
    this.synthesisEngine = new SynthesisEngine(this.ai);
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
        if (error instanceof MissingKeyError || error instanceof InvalidKeyError) {
          throw error;
        }
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

        // Record model used for sequences (choose first if multiple)
        const seqModels = this.sequenceAnalyzer.getModelsUsed();
        const seqFirst = seqModels.values().next().value;
        if (seqFirst) this.modelsUsed['sequences'] = seqFirst;

        // Merge hints back into scene-level if helpful
        this.mergeSequenceFindings(sceneLevel, sequenceResults);
        emit(progress, { sceneLevel, flowIssues, pacingProblems, thematicBreaks });
      } catch (error) {
        if (error instanceof MissingKeyError || error instanceof InvalidKeyError) {
          throw error;
        }
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

        // Record model used for chapters (choose first if multiple)
        const chapModels = this.chapterAnalyzer.getModelsUsed?.();
        if (chapModels && typeof chapModels.values === 'function') {
          const chapFirst = chapModels.values().next().value;
          if (chapFirst) this.modelsUsed['chapters'] = chapFirst;
        }
      } catch (error) {
        if (error instanceof MissingKeyError || error instanceof InvalidKeyError) {
          throw error;
        }
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

        // Record model used for arc validation
        const arcModel = this.arcValidator.getModelUsed?.();
        if (arcModel) this.modelsUsed['arc'] = arcModel;
      } catch (error) {
        if (error instanceof MissingKeyError || error instanceof InvalidKeyError) {
          throw error;
        }
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

        // Record model used for synthesis
        const synthModel = this.synthesisEngine.getModelUsed?.();
        if (synthModel) this.modelsUsed['synthesis'] = synthModel;
      } catch (error) {
        if (error instanceof MissingKeyError || error instanceof InvalidKeyError) {
          throw error;
        }
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
    this.transitionAnalyzer?.cancel();
    this.sequenceAnalyzer?.cancel();
    this.chapterAnalyzer?.cancel();
    this.arcValidator?.cancel();
    this.synthesisEngine?.cancel();
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
    return this.sequenceAnalyzer.analyzeSequences(compressed, scenes, sceneIndex, onProgress);
  }

  private async executeChapterPass(
    manuscript: Manuscript,
    compressed: CompressedScene[],
    onProgress: (percent: number) => void
  ): Promise<ChapterFlowAnalysis[]> {
    return this.chapterAnalyzer.analyzeChapters(manuscript, compressed, onProgress);
  }

  private async executeArcPass(
    manuscript: Manuscript,
    compressed: CompressedScene[],
    onProgress: (percent: number) => void
  ): Promise<ManuscriptAnalysis | undefined> {
    const skeleton = await this.compressor.createManuscriptSkeleton(manuscript);
    return this.arcValidator.validateArc(skeleton, manuscript, onProgress);
  }

  private async executeSynthesisPass(
    sceneLevel: ScenePairAnalysis[],
    chapterLevel: ChapterFlowAnalysis[],
    manuscriptLevel: ManuscriptAnalysis | undefined,
    manuscript: Manuscript,
    settings: GlobalCoherenceSettings,
    onProgress: (percent: number) => void
  ): Promise<GlobalCoherenceAnalysis> {
    return this.synthesisEngine.synthesizeFindings(
      sceneLevel,
      chapterLevel,
      manuscriptLevel,
      manuscript,
      settings,
      onProgress
    );
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