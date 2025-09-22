import type {
  ChapterFlowAnalysis,
  CompressedScene,
  Manuscript,
  Scene
} from '../../../shared/types';
import type { AnalysisResponse } from '../../ai/types';
import AIServiceManager from '../../ai/AIServiceManager';
import { buildChapterPrompt } from '../../ai/prompts/GlobalCoherencePrompts';

/**
 * Analyzes chapter-level coherence and structure.
 * Evaluates if scenes group into meaningful narrative units.
 */
export class ChapterAnalyzer {
  private cancelled = false;
  private modelsUsed: Map<string, string> = new Map();
  private defaultChapterSize = 10; // scenes per chapter

  constructor(private aiManager: AIServiceManager) {}

  /**
   * Analyze chapters for coherence and structure
   */
  async analyzeChapters(
    manuscript: Manuscript,
    compressed: CompressedScene[],
    onProgress?: (percent: number) => void
  ): Promise<ChapterFlowAnalysis[]> {
    if (!compressed || compressed.length === 0) {
      console.debug('[ChapterAnalyzer] No scenes to analyze');
      return [];
    }

    // Group scenes into chapters (use existing chapter breaks or default grouping)
    const chapters = this.identifyChapters(manuscript, compressed);
    const results: ChapterFlowAnalysis[] = [];
    let processed = 0;

    for (const [chapterNum, chapterScenes] of chapters.entries()) {
      if (this.cancelled) {
        console.debug('[ChapterAnalyzer] Analysis cancelled');
        break;
      }

      try {
        const analysis = await this.analyzeChapter(
          chapterScenes,
          chapterNum + 1
        );
        results.push(analysis);
      } catch (error) {
        console.debug(`[ChapterAnalyzer] Failed to analyze chapter ${chapterNum + 1}:`, error);
        results.push(this.createFallbackAnalysis(chapterScenes, chapterNum + 1));
      }

      processed++;
      onProgress?.(Math.floor((processed / chapters.length) * 100));
    }

    return results;
  }

  /**
   * Identify chapter boundaries
   */
  private identifyChapters(
    manuscript: Manuscript,
    compressed: CompressedScene[]
  ): CompressedScene[][] {
    const chapters: CompressedScene[][] = [];
    let currentChapter: CompressedScene[] = [];

    // Look for explicit chapter markers in scene text
    for (let i = 0; i < compressed.length; i++) {
      const scene = compressed[i];
      const originalScene = manuscript.scenes.find(s => s.id === scene.id);
      
      // Check if this scene starts a new chapter
      const isChapterStart = this.isChapterBoundary(originalScene, i === 0);
      
      if (isChapterStart && currentChapter.length > 0) {
        chapters.push(currentChapter);
        currentChapter = [];
      }
      
      currentChapter.push(scene);
      
      // Default chapter size fallback
      if (currentChapter.length >= this.defaultChapterSize) {
        chapters.push(currentChapter);
        currentChapter = [];
      }
    }

    // Add remaining scenes
    if (currentChapter.length > 0) {
      chapters.push(currentChapter);
    }

    return chapters.length > 0 ? chapters : [compressed]; // Fallback to single chapter
  }

  /**
   * Check if a scene represents a chapter boundary
   */
  private isChapterBoundary(scene?: Scene, isFirst?: boolean): boolean {
    if (isFirst) return true;
    if (!scene?.text) return false;
    
    const text = scene.text.toLowerCase();
    return /chapter\s+\d+|chapter\s+[ivxlcdm]+|\[chapter|^chapter\s/i.test(text.slice(0, 200));
  }

  /**
   * Analyze a single chapter
   */
  private async analyzeChapter(
    scenes: CompressedScene[],
    chapterNumber: number
  ): Promise<ChapterFlowAnalysis> {
    try {
      // Calculate total word count
      const totalWords = scenes.reduce((sum, s) => sum + s.metadata.wordCount, 0);
      
      // Build prompt using GlobalCoherencePrompts
      const prompt = buildChapterPrompt(scenes, chapterNumber, totalWords);
      
      // Create minimal scene for request (align with local Scene interface)
      const syntheticScene: any = {
        id: `chapter-${chapterNumber}`,
        text: prompt,
        wordCount: totalWords,
        position: scenes[0].position,
        originalPosition: scenes[0].position,
        characters: [],
        timeMarkers: [],
        locationMarkers: [],
        hasBeenMoved: false,
        rewriteStatus: 'pending'
      };

      // Build request following local analyzer patterns
      const request: any = {
        scene: syntheticScene,
        previousScenes: [],
        analysisType: 'consistency',
        readerContext: {
          knownCharacters: new Set(),
          establishedTimeline: [],
          revealedPlotPoints: [],
          establishedSettings: []
        },
        options: {
          focusAreas: ['chapter-coherence'],
          modelOverride: 'claude-sonnet-4'
        }
      };

      const response = await this.aiManager.analyzeContinuity(request);
      this.modelsUsed.set(`chapter-${chapterNumber}`, response.metadata?.modelUsed || 'unknown');
      
      return this.parseChapterResponse(response, scenes, chapterNumber);

    } catch (error) {
      console.debug(`[ChapterAnalyzer] AI analysis failed for chapter ${chapterNumber}:`, error);
      return this.createFallbackAnalysis(scenes, chapterNumber);
    }
  }

  /**
   * Parse AI response into ChapterFlowAnalysis
   */
  private parseChapterResponse(
    response: AnalysisResponse,
    scenes: CompressedScene[],
    chapterNumber: number
  ): ChapterFlowAnalysis {
    const data = response as any;
    const sceneIds = scenes.map(s => s.id);

    // Try to find chapter analysis in various response formats
    const chapterData = data.chapterAnalysis || data.analysis || data;

    return {
      chapterNumber,
      sceneIds,
      coherenceScore: this.parseScore(chapterData.coherenceScore),
      issues: {
        unity: !(chapterData.issues?.unity ?? true),
        completeness: !(chapterData.issues?.completeness ?? true),
        balancedPacing: !(chapterData.issues?.balancedPacing ?? true),
        narrativePurpose: !(chapterData.issues?.narrativePurpose ?? true)
      },
      recommendations: {
        shouldSplit: Boolean(chapterData.shouldSplit),
        shouldMergeWithNext: Boolean(chapterData.shouldMergeWithNext),
        orphanedScenes: Array.isArray(chapterData.orphanedScenes)
          ? chapterData.orphanedScenes
          : [],
        missingElements: Array.isArray(chapterData.missingElements)
          ? chapterData.missingElements
          : []
      },
      pacingProfile: {
        frontLoaded: Boolean(chapterData.pacingIssues?.frontLoaded),
        saggyMiddle: Boolean(chapterData.pacingIssues?.saggyMiddle),
        rushedEnding: Boolean(chapterData.pacingIssues?.rushedEnding)
      }
    };
  }

  /**
   * Create fallback analysis using heuristics
   */
  private createFallbackAnalysis(
    scenes: CompressedScene[],
    chapterNumber: number
  ): ChapterFlowAnalysis {
    const sceneIds = scenes.map(s => s.id);
    const tensions = scenes.map(s => s.metadata.tensionLevel);
    
    // Simple heuristics
    const avgTension = tensions.reduce((a, b) => a + b, 0) / tensions.length;
    const frontTension = tensions.slice(0, Math.ceil(tensions.length / 3));
    const middleTension = tensions.slice(Math.ceil(tensions.length / 3), Math.ceil(2 * tensions.length / 3));
    const endTension = tensions.slice(Math.ceil(2 * tensions.length / 3));
    
    const avgFront = frontTension.reduce((a, b) => a + b, 0) / (frontTension.length || 1);
    const avgMiddle = middleTension.reduce((a, b) => a + b, 0) / (middleTension.length || 1);
    const avgEnd = endTension.reduce((a, b) => a + b, 0) / (endTension.length || 1);

    return {
      chapterNumber,
      sceneIds,
      coherenceScore: 0.6,
      issues: {
        unity: scenes.length > 15, // Too many scenes suggests lack of unity
        completeness: scenes.length < 3, // Too few scenes
        balancedPacing: Math.abs(avgFront - avgEnd) > 3,
        narrativePurpose: avgTension < 3 // Low tension suggests weak purpose
      },
      recommendations: {
        shouldSplit: scenes.length > 15,
        shouldMergeWithNext: scenes.length < 3,
        orphanedScenes: [],
        missingElements: avgTension < 3 ? ['Conflict or tension'] : []
      },
      pacingProfile: {
        frontLoaded: avgFront > avgMiddle + 2 && avgFront > avgEnd + 2,
        saggyMiddle: avgMiddle < avgFront - 2 && avgMiddle < avgEnd - 2,
        rushedEnding: avgEnd > avgMiddle + 3
      }
    };
  }

  private parseScore(value: any): number {
    const num = parseFloat(String(value));
    return isNaN(num) ? 0.5 : Math.max(0, Math.min(1, num));
  }

  cancel(): void {
    this.cancelled = true;
    console.debug('[ChapterAnalyzer] Analysis cancelled');
  }

  /**
   * Get models used for analysis (for reporting)
   */
  getModelsUsed(): Map<string, string> {
    return new Map(this.modelsUsed);
  }
}