import type {
  ManuscriptAnalysis,
  Manuscript
} from '../../../shared/types';
import AIServiceManager from '../../ai/AIServiceManager';
import { buildArcPrompt } from '../../ai/prompts/GlobalCoherencePrompts';

/**
 * Validates overall story structure and character arcs.
 * Analyzes three-act structure, protagonist journey, and thematic execution.
 */
export class ArcValidator {
  private cancelled = false;
  private modelUsed = '';

  constructor(private aiManager: AIServiceManager) {}

  /**
   * Validate manuscript arc and structure
   */
  async validateArc(
    skeleton: any,
    manuscript: Manuscript,
    onProgress?: (percent: number) => void
  ): Promise<ManuscriptAnalysis | undefined> {
    try {
      onProgress?.(20);

      // Extract main characters from manuscript
      const mainCharacters = this.identifyMainCharacters(manuscript);

      onProgress?.(40);

      // Prepare skeleton with acts if not provided
      const enrichedSkeleton = {
        acts: skeleton?.acts || this.inferActs(manuscript),
        totalScenes: manuscript.scenes.length,
        mainCharacters,
        primaryTheme: this.inferTheme(manuscript)
      };

      onProgress?.(60);

      // Build prompt and analyze
      const prompt = buildArcPrompt(enrichedSkeleton);

      // Use loose typing (any) to allow provider-specific options like modelOverride
      const request: any = {
        scene: {
          id: 'manuscript-arc',
          text: prompt,
          wordCount: 1000,
          position: 0,
          originalPosition: 0,
          characters: mainCharacters,
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        },
        previousScenes: [],
        analysisType: 'complex',
        readerContext: {
          knownCharacters: new Set(mainCharacters),
          establishedTimeline: [],
          revealedPlotPoints: [],
          establishedSettings: []
        },
        options: {
          focusAreas: ['story-arc'],
          modelOverride: 'claude-opus-4-1' // Complex reasoning
        }
      };

      const response = await this.aiManager.analyzeContinuity(request);
      this.modelUsed = response.metadata?.modelUsed || 'unknown';

      onProgress?.(90);

      const analysis = this.parseArcResponse(response, enrichedSkeleton);

      onProgress?.(100);
      return analysis;

    } catch (error) {
      console.error('[ArcValidator] Analysis failed:', error);
      onProgress?.(100);
      return this.createFallbackAnalysis(manuscript);
    }
  }

  /**
   * Identify main characters by frequency
   */
  private identifyMainCharacters(manuscript: Manuscript): string[] {
    const characterCounts = new Map<string, number>();

    for (const scene of manuscript.scenes) {
      for (const char of scene.characters || []) {
        characterCounts.set(char, (characterCounts.get(char) || 0) + 1);
      }
    }

    // Get top 5 most frequent characters
    return Array.from(characterCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
  }

  /**
   * Infer three-act structure
   */
  private inferActs(manuscript: Manuscript): Array<{ summary: string; chapterRange: [number, number] }> {
    const totalScenes = manuscript.scenes.length;
    const act1End = Math.floor(totalScenes * 0.25);
    const act2End = Math.floor(totalScenes * 0.75);

    return [
      {
        summary: 'Setup and introduction',
        chapterRange: [1, Math.ceil(act1End / 10)]
      },
      {
        summary: 'Rising action and complications',
        chapterRange: [Math.ceil(act1End / 10) + 1, Math.ceil(act2End / 10)]
      },
      {
        summary: 'Climax and resolution',
        chapterRange: [Math.ceil(act2End / 10) + 1, Math.ceil(totalScenes / 10)]
      }
    ];
  }

  /**
   * Infer primary theme from manuscript
   */
  private inferTheme(manuscript: Manuscript): string {
    // Simple heuristic - could be enhanced
    const avgTension = manuscript.scenes.reduce((sum, s) => {
      const tension = (s as any).metadata?.tensionLevel || 5;
      return sum + tension;
    }, 0) / Math.max(1, manuscript.scenes.length);

    if (avgTension > 7) return 'conflict and resolution';
    if (avgTension < 3) return 'character development';
    return 'journey and transformation';
  }

  /**
   * Parse AI response into ManuscriptAnalysis
   */
  private parseArcResponse(response: any, _skeleton: any): ManuscriptAnalysis {
    const data = (response as any).arcAnalysis || (response as any).analysis || response;

    // Parse character arcs into Map
    const characterArcs = new Map<string, { completeness: number; consistency: number; issues: string[] }>();
    if (data?.characterArcs) {
      if (data.characterArcs.protagonist) {
        characterArcs.set('protagonist', {
          completeness: this.parseScore(data.characterArcs.protagonist.completeness),
          consistency: 0.7,
          issues: data.characterArcs.protagonist.keyMissingElements || []
        });
      }

      // Add other characters if present
      Object.entries<any>(data.characterArcs).forEach(([name, arc]) => {
        if (name !== 'protagonist') {
          characterArcs.set(name, {
            completeness: this.parseScore(arc.completeness),
            consistency: this.parseScore(arc.consistency),
            issues: Array.isArray(arc.issues) ? arc.issues : []
          });
        }
      });
    }

    return {
      structuralIntegrity: this.parseScore(data?.structuralIntegrity),
      actBalance: Array.isArray(data?.actBalance) ? data.actBalance as [number, number, number] : [25, 50, 25],
      characterArcs,
      plotHoles: Array.isArray(data?.plotHoles) ? data.plotHoles as string[] : [],
      unresolvedElements: Array.isArray(data?.unresolvedElements) ? data.unresolvedElements as string[] : [],
      pacingCurve: {
        slowSpots: Array.isArray(data?.pacingCurve?.slowSpots) ? data.pacingCurve.slowSpots : [],
        rushedSections: Array.isArray(data?.pacingCurve?.rushedSections) ? data.pacingCurve.rushedSections : []
      },
      thematicCoherence: this.parseScore(data?.thematicCoherence),
      openingEffectiveness: this.parseScore(data?.openingEffectiveness),
      endingSatisfaction: this.parseScore(data?.endingSatisfaction)
    };
  }

  /**
   * Create fallback analysis
   */
  private createFallbackAnalysis(manuscript: Manuscript): ManuscriptAnalysis {
    const totalScenes = manuscript.scenes.length || 1;
    const act1 = Math.floor(totalScenes * 0.25);
    const act2 = Math.floor(totalScenes * 0.50);
    const act3 = totalScenes - act1 - act2;

    return {
      structuralIntegrity: 0.6,
      actBalance: [
        Math.round((act1 / totalScenes) * 100),
        Math.round((act2 / totalScenes) * 100),
        Math.round((act3 / totalScenes) * 100)
      ],
      characterArcs: new Map([
        ['protagonist', { completeness: 0.5, consistency: 0.5, issues: [] }]
      ]),
      plotHoles: [],
      unresolvedElements: [],
      pacingCurve: {
        slowSpots: [],
        rushedSections: []
      },
      thematicCoherence: 0.6,
      openingEffectiveness: 0.6,
      endingSatisfaction: 0.6
    };
  }

  private parseScore(value: any): number {
    const num = parseFloat(String(value));
    return isNaN(num) ? 0.6 : Math.max(0, Math.min(1, num));
  }

  cancel(): void {
    this.cancelled = true;
    console.debug('[ArcValidator] Analysis cancelled');
  }

  getModelUsed(): string {
    return this.modelUsed;
  }
}