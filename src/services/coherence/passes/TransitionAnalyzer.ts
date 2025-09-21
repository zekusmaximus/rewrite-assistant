import type {
  CompressedScene,
  ScenePairAnalysis,
  IssueSeverity,
  ContinuityIssue,
  ReaderKnowledge
} from '../../../shared/types';
import type { AnalysisRequest, AnalysisResponse } from '../../ai/types';
import AIServiceManager from '../../ai/AIServiceManager';

/**
 * Analyzes transitions between adjacent scenes to identify jarring changes
 * that break narrative flow. Uses fast models for high-volume analysis.
 */
export class TransitionAnalyzer {
  private cancelled = false;
  private modelsUsed: Map<string, string> = new Map();

  constructor(private aiManager: AIServiceManager) {}

  /**
   * Main entry point - analyzes all scene transitions in the manuscript
   * @param compressed - Compressed scenes from ManuscriptCompressor
   * @param onProgress - Progress callback (0-100)
   * @returns Array of transition analyses
   */
  async analyzeTransitions(
    compressed: CompressedScene[],
    onProgress?: (percent: number, currentSceneId?: string) => void
  ): Promise<ScenePairAnalysis[]> {
    if (!compressed || compressed.length < 2) {
      console.debug('[TransitionAnalyzer] Not enough scenes for transition analysis');
      return [];
    }

    const results: ScenePairAnalysis[] = [];
    const totalPairs = compressed.length - 1;
    const batchSize = 5; // Process 5 transitions in parallel
    
    for (let i = 0; i < totalPairs; i += batchSize) {
      if (this.cancelled) {
        console.debug('[TransitionAnalyzer] Analysis cancelled');
        break;
      }

      const batchEnd = Math.min(i + batchSize, totalPairs);
      const batchPromises: Promise<ScenePairAnalysis>[] = [];

      for (let j = i; j < batchEnd; j++) {
        batchPromises.push(
          this.analyzeTransitionPair(compressed[j], compressed[j + 1], j)
        );
      }

      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            results.push(result.value);
          } else if (result.status === 'rejected') {
            console.debug('[TransitionAnalyzer] Individual transition failed:', result.reason);
          }
        }

        const progress = Math.floor(((i + batchSize) / totalPairs) * 100);
        onProgress?.(Math.min(progress, 100), compressed[Math.min(i + batchSize, totalPairs - 1)].id);

      } catch (error) {
        console.error(`[TransitionAnalyzer] Batch ${i}-${batchEnd} failed:`, error);
      }
    }

    return results;
  }

  /**
   * Analyze a single scene pair transition
   */
  private async analyzeTransitionPair(
    sceneA: CompressedScene,
    sceneB: CompressedScene,
    position: number
  ): Promise<ScenePairAnalysis> {
    try {
      // Build prompt focused on transition quality
      const prompt = this.buildTransitionPrompt(sceneA, sceneB);
      
      // Create reader context for what's known at this point
      const knownCharacters = new Set([
        ...(sceneA.metadata?.characters ?? []),
        ...(sceneB.metadata?.characters ?? [])
      ]);
      // Build Location[] from strings with unique names
      const seenLoc = new Set<string>();
      const establishedSettings = [
        ...(sceneA.metadata?.locations ?? []),
        ...(sceneB.metadata?.locations ?? [])
      ]
        .filter((loc) => {
          if (!loc) return false;
          if (seenLoc.has(loc)) return false;
          seenLoc.add(loc);
          return true;
        })
        .map((name) => ({ name }));

      const readerContext: ReaderKnowledge = {
        knownCharacters,
        establishedTimeline: [],
        revealedPlotPoints: [],
        establishedSettings
      };

      // Use simple analysis type for fast processing
      // Build a minimal synthetic Scene compatible object
      const syntheticScene: any = {
        id: `${sceneA.id}-${sceneB.id}`,
        text: prompt,
        wordCount: 400, // Approximate compressed content
        position: position,
        originalPosition: position,
        characters: Array.from(knownCharacters),
        timeMarkers: [],
        locationMarkers: [...(sceneA.metadata?.locations ?? []), ...(sceneB.metadata?.locations ?? [])],
        hasBeenMoved: false,
        rewriteStatus: 'pending'
      };

      const request: any = {
        scene: syntheticScene,
        previousScenes: [],
        analysisType: 'simple',
        readerContext,
        // Extra options are tolerated by providers; cast for typing compatibility
        options: {
          focusAreas: ['transitions'],
          modelOverride: 'gpt-5' // Fast model for high volume
        }
      };

      const response = await this.aiManager.analyzeContinuity(request as AnalysisRequest);
      this.modelsUsed.set(`${sceneA.id}-${sceneB.id}`, response.metadata?.modelUsed || 'unknown');

      return this.parseTransitionResponse(response, sceneA, sceneB, position);

    } catch (error) {
      console.debug(`[TransitionAnalyzer] Failed to analyze ${sceneA.id}->${sceneB.id}:`, error);
      return this.createFallbackAnalysis(sceneA, sceneB, position);
    }
  }

  /**
   * Build focused prompt for transition analysis
   */
  private buildTransitionPrompt(sceneA: CompressedScene, sceneB: CompressedScene): string {
    return `Analyze the transition quality between these two adjacent scenes.

SCENE A (ending):
Position: ${sceneA.position}
Summary: ${sceneA.summary}
Final words: "${sceneA.closing}"
Characters: ${sceneA.metadata.characters.join(', ') || 'none'}
Emotional tone: ${sceneA.metadata.emotionalTone}
Tension level: ${sceneA.metadata.tensionLevel}/10

SCENE B (beginning):  
Position: ${sceneB.position}
Summary: ${sceneB.summary}
Opening words: "${sceneB.opening}"
Characters: ${sceneB.metadata.characters.join(', ') || 'none'}
Emotional tone: ${sceneB.metadata.emotionalTone}
Tension level: ${sceneB.metadata.tensionLevel}/10

Evaluate these transition aspects:
1. Temporal continuity - Does time flow logically?
2. Spatial continuity - Are locations consistent?
3. Emotional continuity - Do emotional states transition naturally?
4. Momentum preservation - Does pacing feel right?
5. Hook-to-resolution - Does B follow naturally from A?

Identify specific issues that would jar a reader out of the story.

Return a JSON object with this structure:
{
  "transitionScore": 0.0 to 1.0,
  "issues": [
    {
      "type": "jarring_pace_change" | "emotional_whiplash" | "time_gap" | "location_jump" | "unresolved_tension",
      "severity": "must-fix" | "should-fix" | "minor" | "consider",
      "description": "specific description",
      "suggestion": "how to smooth transition"
    }
  ],
  "strengths": ["what works well"],
  "flags": {
    "needsSceneBreak": boolean,
    "needsTransitionScene": boolean,
    "chapterBoundaryCandidate": boolean
  }
}`;
  }

  /**
   * Parse AI response into ScenePairAnalysis structure
   */
  private parseTransitionResponse(
    response: AnalysisResponse,
    sceneA: CompressedScene,
    sceneB: CompressedScene,
    position: number
  ): ScenePairAnalysis {
    // Handle both direct issues array and nested response structures
    const responseData = response as any;
    let transitionData: any = {};

    // Try to find transition data in various response formats
    if (responseData.transitionScore !== undefined) {
      transitionData = responseData;
    } else if (responseData.transitionAnalysis) {
      transitionData = responseData.transitionAnalysis;
    } else if (responseData.analysis) {
      transitionData = responseData.analysis;
    }

    // Parse issues from response
    const issues: ScenePairAnalysis['issues'] = [];
    
    // First check for transition-specific issues
    if (Array.isArray(transitionData.issues)) {
      for (const issue of transitionData.issues) {
        issues.push({
          type: this.validateTransitionType(issue.type),
          severity: this.validateSeverity(issue.severity),
          description: String(issue.description || 'Transition issue detected'),
          suggestion: String(issue.suggestion || '')
        });
      }
    }
    
    // Also check main continuity issues array for transition problems
    if (Array.isArray((response as any).issues)) {
      for (const issue of (response as any).issues) {
        if (this.isTransitionRelated(issue)) {
          issues.push({
            type: 'jarring_pace_change', // Default type
            severity: (issue as any).severity || 'consider',
            description: (issue as any).description || 'Transition issue',
            suggestion: (issue as any).suggestedFix || ''
          });
        }
      }
    }

    return {
      sceneAId: sceneA.id,
      sceneBId: sceneB.id,
      position,
      transitionScore: this.parseScore(transitionData.transitionScore),
      issues,
      strengths: Array.isArray(transitionData.strengths) 
        ? transitionData.strengths.map(String)
        : [],
      flags: {
        needsSceneBreak: Boolean(transitionData.flags?.needsSceneBreak),
        needsTransitionScene: Boolean(transitionData.flags?.needsTransitionScene),
        chapterBoundaryCandidate: Boolean(transitionData.flags?.chapterBoundaryCandidate)
      }
    };
  }

  /**
   * Create fallback analysis when AI fails
   */
  private createFallbackAnalysis(
    sceneA: CompressedScene,
    sceneB: CompressedScene,
    position: number
  ): ScenePairAnalysis {
    // Basic heuristic analysis
    const issues: ScenePairAnalysis['issues'] = [];
    
    // Check for dramatic tension changes
    const tensionDelta = Math.abs(sceneA.metadata.tensionLevel - sceneB.metadata.tensionLevel);
    if (tensionDelta > 5) {
      issues.push({
        type: 'jarring_pace_change',
        severity: 'should-fix',
        description: `Large tension shift from ${sceneA.metadata.tensionLevel} to ${sceneB.metadata.tensionLevel}`,
        suggestion: 'Consider adding transitional narrative to smooth the tension change'
      });
    }

    // Check for emotional whiplash
    if (sceneA.metadata.emotionalTone && sceneB.metadata.emotionalTone) {
      const moodShift = this.calculateMoodShift(
        sceneA.metadata.emotionalTone,
        sceneB.metadata.emotionalTone
      );
      if (moodShift === 'jarring') {
        issues.push({
          type: 'emotional_whiplash',
          severity: 'should-fix',
          description: `Abrupt mood shift from ${sceneA.metadata.emotionalTone} to ${sceneB.metadata.emotionalTone}`,
          suggestion: 'Add emotional transition or scene break'
        });
      }
    }

    return {
      sceneAId: sceneA.id,
      sceneBId: sceneB.id,
      position,
      transitionScore: issues.length > 0 ? 0.5 : 0.7,
      issues,
      strengths: [],
      flags: {
        needsSceneBreak: tensionDelta > 7,
        needsTransitionScene: issues.length > 2,
        chapterBoundaryCandidate: tensionDelta > 5
      }
    };
  }

  /**
   * Validate and normalize transition issue types
   */
  private validateTransitionType(
    type: string
  ): 'jarring_pace_change' | 'emotional_whiplash' | 'time_gap' | 'location_jump' | 'unresolved_tension' {
    const validTypes = ['jarring_pace_change', 'emotional_whiplash', 'time_gap', 'location_jump', 'unresolved_tension'];
    const normalized = String(type).toLowerCase().replace(/[\s\-_]/g, '_');
    
    if (validTypes.includes(normalized)) {
      return normalized as any;
    }
    
    // Map common variations
    if (normalized.includes('pace') || normalized.includes('pacing')) return 'jarring_pace_change';
    if (normalized.includes('emotion') || normalized.includes('mood')) return 'emotional_whiplash';
    if (normalized.includes('time') || normalized.includes('temporal')) return 'time_gap';
    if (normalized.includes('location') || normalized.includes('spatial')) return 'location_jump';
    if (normalized.includes('tension') || normalized.includes('unresolved')) return 'unresolved_tension';
    
    return 'jarring_pace_change'; // Default
  }

  /**
   * Validate severity levels
   */
  private validateSeverity(severity: string): IssueSeverity {
    const valid: IssueSeverity[] = ['must-fix', 'should-fix', 'consider'];
    const normalized = String(severity).toLowerCase();
    
    if ((valid as unknown as string[]).includes(normalized)) {
      return normalized as IssueSeverity;
    }
    
    // Map common variations
    if (normalized.includes('critical') || normalized.includes('must')) return 'must-fix';
    if (normalized.includes('should') || normalized.includes('important')) return 'should-fix';
    if (normalized.includes('minor') || normalized.includes('small')) return 'consider';
    
    return 'consider'; // Default to lowest severity
  }

  /**
   * Parse score ensuring valid range
   */
  private parseScore(value: any): number {
    const num = parseFloat(String(value));
    if (isNaN(num)) return 0.5;
    return Math.max(0, Math.min(1, num));
  }

  /**
   * Check if a continuity issue is transition-related
   */
  private isTransitionRelated(issue: ContinuityIssue): boolean {
    const desc = (issue.description || '').toLowerCase();
    return desc.includes('transition') ||
           desc.includes('flow') ||
           desc.includes('jarring') ||
           desc.includes('abrupt') ||
           desc.includes('sudden');
  }

  /**
   * Calculate emotional mood shift severity
   */
  private calculateMoodShift(toneA: string, toneB: string): 'smooth' | 'moderate' | 'jarring' {
    const opposites = [
      ['happy', 'sad'],
      ['tense', 'relaxed'],
      ['suspense', 'peaceful'],
      ['angry', 'calm']
    ];
    
    for (const pair of opposites) {
      if ((pair.includes(toneA) && pair.includes(toneB)) ||
          (pair.includes(toneB) && pair.includes(toneA))) {
        return 'jarring';
      }
    }
    
    if (toneA === toneB) return 'smooth';
    return 'moderate';
  }

  /**
   * Cancel ongoing analysis
   */
  cancel(): void {
    this.cancelled = true;
    console.debug('[TransitionAnalyzer] Analysis cancelled');
  }

  /**
   * Get models used for analysis (for reporting)
   */
  getModelsUsed(): Map<string, string> {
    return new Map(this.modelsUsed);
  }
}