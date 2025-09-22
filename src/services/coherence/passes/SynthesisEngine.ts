import type {
  GlobalCoherenceAnalysis,
  GlobalCoherenceSettings,
  ScenePairAnalysis,
  ChapterFlowAnalysis,
  ManuscriptAnalysis,
  Manuscript,
  NarrativeFlowIssue,
  PacingIssue,
  ThematicDiscontinuity,
  CharacterArcIssue
} from '../../../shared/types';
import AIServiceManager from '../../ai/AIServiceManager';
import { buildSynthesisPrompt } from '../../ai/prompts/GlobalCoherencePrompts';

/**
 * Synthesizes findings from all analysis passes into prioritized recommendations.
 * Identifies patterns, clusters, and root causes across all issue types.
 */
export class SynthesisEngine {
  private cancelled = false;
  private modelUsed = '';

  constructor(private aiManager: AIServiceManager) {}

  /**
   * Synthesize all findings into unified analysis
   */
  async synthesizeFindings(
    sceneLevel: ScenePairAnalysis[],
    chapterLevel: ChapterFlowAnalysis[],
    manuscriptLevel: ManuscriptAnalysis | undefined,
    manuscript: Manuscript,
    settings: GlobalCoherenceSettings,
    onProgress?: (percent: number) => void
  ): Promise<GlobalCoherenceAnalysis> {
    try {
      onProgress?.(10);

      // Count issues for synthesis
      const transitionIssues = sceneLevel.reduce((sum, t) => sum + t.issues.length, 0);
      const chapterIssues = chapterLevel.filter(c =>
        c.recommendations.shouldSplit || c.recommendations.shouldMergeWithNext
      ).length;

      // Extract flow/pacing/theme issues from existing data
      const {
        flowIssues,
        pacingProblems,
        thematicBreaks,
        characterArcDisruptions
      } = this.extractGlobalIssues(sceneLevel, chapterLevel, manuscriptLevel);

      onProgress?.(30);

      // Skip AI synthesis if minimal issues found
      if (transitionIssues + flowIssues.length + pacingProblems.length < 3) {
        console.debug('[SynthesisEngine] Minimal issues found, skipping AI synthesis');
        return this.createBasicSynthesis(
          sceneLevel,
          chapterLevel,
          manuscriptLevel,
          flowIssues,
          pacingProblems,
          thematicBreaks,
          characterArcDisruptions,
          settings
        );
      }

      onProgress?.(50);

      // Build synthesis prompt
      const findings = {
        transitionIssueCount: transitionIssues,
        flowIssueCount: flowIssues.length,
        pacingIssueCount: pacingProblems.length,
        chapterIssueCount: chapterIssues,
        arcIssues: manuscriptLevel?.plotHoles,
        totalScenes: manuscript.scenes.length,
        movedScenes: manuscript.scenes.filter(s => s.hasBeenMoved).length
      };

      const prompt = buildSynthesisPrompt(findings);

      // Build request; use any to allow provider options
      const request: any = {
        scene: {
          id: 'synthesis',
          text: prompt,
          wordCount: 500,
          position: 0,
          originalPosition: 0,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        },
        previousScenes: [],
        analysisType: 'complex',
        readerContext: {
          knownCharacters: new Set(),
          establishedTimeline: [],
          revealedPlotPoints: [],
          establishedSettings: []
        },
        options: {
          focusAreas: ['synthesis'],
          modelOverride: 'claude-sonnet-4'
        }
      };

      onProgress?.(70);

      const response = await this.aiManager.analyzeContinuity(request);
      this.modelUsed = response.metadata?.modelUsed || 'unknown';

      // Enhance issues with synthesis insights
      const enhancedIssues = this.enhanceWithSynthesis(
        response,
        flowIssues,
        pacingProblems,
        thematicBreaks,
        characterArcDisruptions
      );

      onProgress?.(90);

      const result: GlobalCoherenceAnalysis = {
        sceneLevel,
        chapterLevel,
        manuscriptLevel: manuscriptLevel || this.createDefaultManuscriptAnalysis(),
        flowIssues: enhancedIssues.flow,
        pacingProblems: enhancedIssues.pacing,
        thematicBreaks: enhancedIssues.theme,
        characterArcDisruptions: enhancedIssues.characterArc,
        timestamp: Date.now(),
        totalAnalysisTime: 0,
        modelsUsed: { synthesis: this.modelUsed },
        settings
      };

      onProgress?.(100);
      return result;

    } catch (error) {
      console.error('[SynthesisEngine] Synthesis failed:', error);
      onProgress?.(100);

      // Return non-synthesized results
      return this.createBasicSynthesis(
        sceneLevel,
        chapterLevel,
        manuscriptLevel,
        [],
        [],
        [],
        [],
        settings
      );
    }
  }

  /**
   * Extract global issues from pass results
   */
  private extractGlobalIssues(
    sceneLevel: ScenePairAnalysis[],
    chapterLevel: ChapterFlowAnalysis[],
    manuscriptLevel?: ManuscriptAnalysis
  ): {
    flowIssues: NarrativeFlowIssue[];
    pacingProblems: PacingIssue[];
    thematicBreaks: ThematicDiscontinuity[];
    characterArcDisruptions: CharacterArcIssue[];
  } {
    const flowIssues: NarrativeFlowIssue[] = [];
    const pacingProblems: PacingIssue[] = [];
    const thematicBreaks: ThematicDiscontinuity[] = [];
    const characterArcDisruptions: CharacterArcIssue[] = [];

    // Extract from scene transitions
    for (const transition of sceneLevel) {
      if (transition.transitionScore < 0.5) {
        // Poor transitions indicate flow issues
        if (transition.issues.some(i => i.type === 'unresolved_tension')) {
          flowIssues.push({
            type: 'flow',
            severity: 'should-fix',
            description: `Flow disruption between ${transition.sceneAId} and ${transition.sceneBId}`,
            textSpan: [0, 100],
            affectedScenes: [transition.sceneAId, transition.sceneBId],
            pattern: 'broken_causality'
          });
        }

        // Pace changes indicate pacing problems
        if (transition.issues.some(i => i.type === 'jarring_pace_change')) {
          pacingProblems.push({
            type: 'pacing',
            severity: 'should-fix',
            description: `Pacing disruption at scene ${transition.sceneBId}`,
            textSpan: [0, 100],
            affectedScenes: [transition.sceneAId, transition.sceneBId],
            pattern: 'inconsistent',
            tensionDelta: 5
          });
        }
      }
    }

    // Extract from chapters
    for (const chapter of chapterLevel) {
      if (chapter.pacingProfile.saggyMiddle) {
        pacingProblems.push({
          type: 'pacing',
          severity: 'consider',
          description: `Chapter ${chapter.chapterNumber} has pacing issues in middle`,
          textSpan: [0, 100],
          affectedScenes: chapter.sceneIds,
          pattern: 'too_slow',
          tensionDelta: -3
        });
      }
    }

    // Extract from manuscript level character arcs
    if (manuscriptLevel?.characterArcs) {
      manuscriptLevel.characterArcs.forEach((arc, character) => {
        if (arc.completeness < 0.5) {
          characterArcDisruptions.push({
            type: 'character_arc',
            severity: 'should-fix',
            description: `${character} arc is incomplete`,
            textSpan: [0, 100],
            characterName: character,
            arcType: 'incomplete',
            affectedScenes: []
          });
        }
      });
    }

    return { flowIssues, pacingProblems, thematicBreaks, characterArcDisruptions };
  }

  /**
   * Enhance issues with synthesis insights
   */
  private enhanceWithSynthesis(
    response: any,
    flowIssues: NarrativeFlowIssue[],
    pacingProblems: PacingIssue[],
    thematicBreaks: ThematicDiscontinuity[],
    characterArcDisruptions: CharacterArcIssue[]
  ): {
    flow: NarrativeFlowIssue[];
    pacing: PacingIssue[];
    theme: ThematicDiscontinuity[];
    characterArc: CharacterArcIssue[];
  } {
    const data = (response as any).synthesisAnalysis || (response as any).analysis || response;

    // Use synthesis to prioritize issues by escalating severity for high-impact patterns
    if (data?.topPriorities && Array.isArray(data.topPriorities)) {
      for (const priority of data.topPriorities) {
        if (priority.impact === 'high') {
          const matchText = String(priority.issuePattern ?? '').toLowerCase();

          const escalate = (severity: 'must-fix' | 'should-fix' | 'consider'): 'must-fix' | 'should-fix' | 'consider' =>
            severity === 'must-fix' ? 'must-fix' : 'must-fix';

          flowIssues.forEach(issue => {
            if (issue.description.toLowerCase().includes(matchText)) {
              issue.severity = escalate(issue.severity);
            }
          });
          pacingProblems.forEach(issue => {
            if (issue.description.toLowerCase().includes(matchText)) {
              issue.severity = escalate(issue.severity);
            }
          });
          thematicBreaks.forEach(issue => {
            if (issue.description.toLowerCase().includes(matchText)) {
              issue.severity = escalate(issue.severity);
            }
          });
          characterArcDisruptions.forEach(issue => {
            if (issue.description.toLowerCase().includes(matchText)) {
              issue.severity = escalate(issue.severity);
            }
          });
        }
      }
    }

    return {
      flow: flowIssues,
      pacing: pacingProblems,
      theme: thematicBreaks,
      characterArc: characterArcDisruptions
    };
  }

  /**
   * Create basic synthesis without AI
   */
  private createBasicSynthesis(
    sceneLevel: ScenePairAnalysis[],
    chapterLevel: ChapterFlowAnalysis[],
    manuscriptLevel: ManuscriptAnalysis | undefined,
    flowIssues: NarrativeFlowIssue[],
    pacingProblems: PacingIssue[],
    thematicBreaks: ThematicDiscontinuity[],
    characterArcDisruptions: CharacterArcIssue[],
    settings: GlobalCoherenceSettings
  ): GlobalCoherenceAnalysis {
    return {
      sceneLevel,
      chapterLevel,
      manuscriptLevel: manuscriptLevel || this.createDefaultManuscriptAnalysis(),
      flowIssues,
      pacingProblems,
      thematicBreaks,
      characterArcDisruptions,
      timestamp: Date.now(),
      totalAnalysisTime: 0,
      modelsUsed: {},
      settings
    };
  }

  /**
   * Create default manuscript analysis
   */
  private createDefaultManuscriptAnalysis(): ManuscriptAnalysis {
    return {
      structuralIntegrity: 0.7,
      actBalance: [25, 50, 25],
      characterArcs: new Map(),
      plotHoles: [],
      unresolvedElements: [],
      pacingCurve: {
        slowSpots: [],
        rushedSections: []
      },
      thematicCoherence: 0.7,
      openingEffectiveness: 0.7,
      endingSatisfaction: 0.7
    };
  }

  cancel(): void {
    this.cancelled = true;
    console.debug('[SynthesisEngine] Analysis cancelled');
  }

  getModelUsed(): string {
    return this.modelUsed;
  }
}