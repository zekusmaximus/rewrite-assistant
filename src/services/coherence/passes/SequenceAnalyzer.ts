import type {
  CompressedScene,
  Scene,
  NarrativeFlowIssue,
  PacingIssue,
  ThematicDiscontinuity,
  IssueSeverity,
  ContinuityIssue,
  ReaderKnowledge
} from '../../../shared/types';
import type { AnalysisResponse } from '../../ai/types';
import AIServiceManager from '../../ai/AIServiceManager';

export interface SequenceResults {
  flow: NarrativeFlowIssue[];
  pacing: PacingIssue[];
  theme: ThematicDiscontinuity[];
}

/**
 * Analyzes narrative coherence across 3-5 scene windows.
 * Detects causality breaks, pacing issues, and thematic discontinuities.
 */
export class SequenceAnalyzer {
  private cancelled = false;
  private modelsUsed: Map<string, string> = new Map();
  private windowSize = 3; // Default sliding window size

  constructor(private aiManager: AIServiceManager) {}

  /**
   * Analyze narrative flow across scene sequences
   * @param compressed - Compressed scenes from ManuscriptCompressor
   * @param fullScenes - Full Scene objects with complete text (for richer context if needed)
   * @param sceneIndex - Map of scene ID to Scene for quick lookup
   * @param onProgress - Progress callback with percent and current scene ID
   */
  async analyzeSequences(
    compressed: CompressedScene[],
    fullScenes: Scene[],
    sceneIndex: Map<string, Scene>,
    onProgress?: (percent: number, currentSceneId?: string) => void
  ): Promise<SequenceResults> {
    const results: SequenceResults = {
      flow: [],
      pacing: [],
      theme: []
    };

    if (!compressed || compressed.length < this.windowSize) {
      console.debug('[SequenceAnalyzer] Not enough scenes for sequence analysis');
      return results;
    }

    // Create sliding windows
    const windows = this.createSlidingWindows(compressed);
    const totalWindows = windows.length;
    let processedWindows = 0;

    // Process windows in batches for efficiency
    const batchSize = 3; // Process 3 windows in parallel
    
    for (let i = 0; i < windows.length; i += batchSize) {
      if (this.cancelled) {
        console.debug('[SequenceAnalyzer] Analysis cancelled');
        break;
      }

      const batch = windows.slice(i, Math.min(i + batchSize, windows.length));
      const batchPromises = batch.map(window => 
        this.analyzeSequenceWindow(window, fullScenes, sceneIndex)
      );

      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            // Aggregate results from each window
            results.flow.push(...result.value.flow);
            results.pacing.push(...result.value.pacing);
            results.theme.push(...result.value.theme);
          } else if (result.status === 'rejected') {
            console.debug('[SequenceAnalyzer] Window analysis failed:', result.reason);
          }
        }

        processedWindows += batch.length;
        const progress = Math.floor((processedWindows / totalWindows) * 100);
        const lastSceneId = batch[batch.length - 1]?.[batch[0].length - 1]?.id;
        onProgress?.(progress, lastSceneId);

      } catch (error) {
        console.error('[SequenceAnalyzer] Batch processing failed:', error);
      }
    }

    // Deduplicate and consolidate overlapping issues
    return this.consolidateResults(results);
  }

  /**
   * Create sliding windows of scenes for analysis
   */
  private createSlidingWindows(scenes: CompressedScene[]): CompressedScene[][] {
    const windows: CompressedScene[][] = [];
    const stride = Math.max(1, Math.floor(this.windowSize / 2)); // Overlap windows
    
    for (let i = 0; i <= scenes.length - this.windowSize; i += stride) {
      windows.push(scenes.slice(i, i + this.windowSize));
    }
    
    return windows;
  }

  /**
   * Analyze a single window of scenes
   */
  private async analyzeSequenceWindow(
    window: CompressedScene[],
    fullScenes: Scene[],
    sceneIndex: Map<string, Scene>
  ): Promise<SequenceResults> {
    const results: SequenceResults = {
      flow: [],
      pacing: [],
      theme: []
    };

    try {
      // Build comprehensive prompt for sequence analysis
      const prompt = this.buildSequencePrompt(window);
      void prompt; // reserved for providers that accept raw prompts
      
      // Get full scene for the target (last scene in window)
      const targetScene = sceneIndex.get(window[window.length - 1].id);
      if (!targetScene) {
        console.debug('[SequenceAnalyzer] Target scene not found:', window[window.length - 1].id);
        return results;
      }

      // Build reader context from window
      const readerContext = this.buildReaderContext(window);

      // Use 'consistency' type for narrative flow analysis
      const request = {
        scene: targetScene,
        previousScenes: window.slice(0, -1).map(cs =>
          sceneIndex.get(cs.id) || this.createPlaceholderScene(cs)
        ),
        analysisType: 'consistency',
        readerContext,
        options: {
          focusAreas: ['sequence-flow', 'pacing', 'themes'],
          modelOverride: 'claude-sonnet-4'
        }
      } as any;

      const response = await this.aiManager.analyzeContinuity(request);
      this.modelsUsed.set(window.map(s => s.id).join('-'), response.metadata?.modelUsed || 'unknown');

      // Parse response into sequence-specific issues
      return this.parseSequenceResponse(response, window, targetScene);

    } catch (error) {
      console.debug('[SequenceAnalyzer] Failed to analyze window:', error);
      return this.createFallbackAnalysis(window);
    }
  }

  /**
   * Build prompt for sequence analysis
   */
  private buildSequencePrompt(window: CompressedScene[]): string {
    const sceneDescriptions = window.map((scene, idx) => 
      `Scene ${idx + 1} (${scene.id}):
Summary: ${scene.summary}
Characters: ${scene.metadata.characters.join(', ') || 'none'}
Tension: ${scene.metadata.tensionLevel}/10
Emotional tone: ${scene.metadata.emotionalTone}`
    ).join('\n\n');

    return `Analyze the narrative flow across this sequence of ${window.length} consecutive scenes.

${sceneDescriptions}

Evaluate these narrative dimensions:
1. CAUSALITY: Do events follow clear cause-and-effect relationships?
2. ESCALATION: Does tension build or release appropriately?
3. INFORMATION REVEAL: Is information revealed at the right pace?
4. CHARACTER AGENCY: Do character actions drive the plot forward?
5. THEMATIC CONSISTENCY: Do themes develop coherently?

Identify specific issues that disrupt narrative flow, create pacing problems, or break thematic continuity.

Return a JSON object with:
{
  "flowIssues": [
    {
      "pattern": "broken_causality" | "passive_sequence" | "info_dump" | "info_gap",
      "description": "specific description",
      "severity": "must-fix" | "should-fix" | "consider",
      "affectedScenes": ["scene IDs"]
    }
  ],
  "pacingIssues": [
    {
      "pattern": "too_slow" | "too_fast" | "inconsistent",
      "description": "specific description", 
      "tensionDelta": number,
      "affectedScenes": ["scene IDs"]
    }
  ],
  "thematicIssues": [
    {
      "theme": "theme name",
      "description": "how theme is broken",
      "lastSeenScene": "scene ID",
      "brokenAtScene": "scene ID"
    }
  ],
  "causalityChain": ["event1->event2", "event2->event3"],
  "tensionCurve": [array of tension values],
  "suggestions": ["specific fixes"]
}`;
  }

  /**
   * Parse AI response into sequence results
   */
  private parseSequenceResponse(
    response: AnalysisResponse,
    window: CompressedScene[],
    targetScene: Scene
  ): SequenceResults {
    const results: SequenceResults = {
      flow: [],
      pacing: [],
      theme: []
    };

    const data = response as any;
    const windowSceneIds = window.map(s => s.id);

    // Parse flow issues
    if (Array.isArray(data.flowIssues)) {
      for (const issue of data.flowIssues) {
        results.flow.push({
          type: 'flow',
          severity: this.validateSeverity(issue.severity),
          description: String(issue.description || 'Narrative flow disruption'),
          textSpan: [0, 100], // Default span
          affectedScenes: Array.isArray(issue.affectedScenes) 
            ? issue.affectedScenes 
            : windowSceneIds,
          pattern: this.validateFlowPattern(issue.pattern)
        });
      }
    }

    // Parse pacing issues
    if (Array.isArray(data.pacingIssues)) {
      for (const issue of data.pacingIssues) {
        results.pacing.push({
          type: 'pacing',
          severity: this.validateSeverity(issue.severity),
          description: String(issue.description || 'Pacing inconsistency'),
          textSpan: [0, 100],
          affectedScenes: Array.isArray(issue.affectedScenes)
            ? issue.affectedScenes
            : windowSceneIds,
          pattern: this.validatePacingPattern(issue.pattern),
          tensionDelta: Number(issue.tensionDelta) || 0
        });
      }
    }

    // Parse thematic issues
    if (Array.isArray(data.thematicIssues)) {
      for (const issue of data.thematicIssues) {
        results.theme.push({
          type: 'theme',
          severity: this.validateSeverity(issue.severity),
          description: String(issue.description || 'Thematic discontinuity'),
          textSpan: [0, 100],
          theme: String(issue.theme || 'unspecified'),
          lastSeenScene: String(issue.lastSeenScene || window[0].id),
          brokenAtScene: String(issue.brokenAtScene || targetScene.id)
        });
      }
    }

    // Also check main issues array for sequence-related problems
    if (Array.isArray(response.issues)) {
      for (const issue of response.issues) {
        const converted = this.convertToSequenceIssue(issue, windowSceneIds, targetScene.id);
        if (converted) {
          if (converted.type === 'flow') results.flow.push(converted as NarrativeFlowIssue);
          else if (converted.type === 'pacing') results.pacing.push(converted as PacingIssue);
          else if (converted.type === 'theme') results.theme.push(converted as ThematicDiscontinuity);
        }
      }
    }

    return results;
  }

  /**
   * Convert generic continuity issue to sequence-specific issue
   */
  private convertToSequenceIssue(
    issue: ContinuityIssue,
    windowSceneIds: string[],
    targetSceneId: string
  ): NarrativeFlowIssue | PacingIssue | ThematicDiscontinuity | null {
    const desc = (issue.description || '').toLowerCase();
    
    // Detect flow issues
    if (issue.type === 'plot' || issue.type === 'timeline' || 
        desc.includes('causality') || desc.includes('cause') || desc.includes('passive')) {
      return {
        type: 'flow',
        severity: issue.severity,
        description: issue.description,
        textSpan: issue.textSpan || [0, 100],
        affectedScenes: windowSceneIds,
        pattern: desc.includes('passive') ? 'passive_sequence' : 
                 desc.includes('info') ? 'info_gap' : 'broken_causality'
      };
    }

    // Detect pacing issues
    if (issue.type === 'engagement' || desc.includes('pacing') || 
        desc.includes('slow') || desc.includes('fast') || desc.includes('tension')) {
      return {
        type: 'pacing',
        severity: issue.severity,
        description: issue.description,
        textSpan: issue.textSpan || [0, 100],
        affectedScenes: windowSceneIds,
        pattern: desc.includes('slow') ? 'too_slow' : 
                 desc.includes('fast') ? 'too_fast' : 'inconsistent',
        tensionDelta: 0
      };
    }

    // Detect thematic issues
    if (issue.type === 'context' || desc.includes('theme') || desc.includes('motif')) {
      return {
        type: 'theme',
        severity: issue.severity,
        description: issue.description,
        textSpan: issue.textSpan || [0, 100],
        theme: 'narrative',
        lastSeenScene: windowSceneIds[0],
        brokenAtScene: targetSceneId
      };
    }

    return null;
  }

  /**
   * Create fallback analysis using heuristics
   */
  private createFallbackAnalysis(window: CompressedScene[]): SequenceResults {
    const results: SequenceResults = {
      flow: [],
      pacing: [],
      theme: []
    };

    // Check tension progression
    const tensions = window.map(s => s.metadata.tensionLevel);
    const avgTension = tensions.reduce((a, b) => a + b, 0) / tensions.length;
    const variance = tensions.reduce((sum, t) => sum + Math.pow(t - avgTension, 2), 0) / tensions.length;

    // High variance indicates pacing issues
    if (variance > 10) {
      results.pacing.push({
        type: 'pacing',
        severity: 'should-fix',
        description: 'Inconsistent tension levels across sequence',
        textSpan: [0, 100],
        affectedScenes: window.map(s => s.id),
        pattern: 'inconsistent',
        tensionDelta: Math.max(...tensions) - Math.min(...tensions)
      });
    }

    // Check for passive sequences (low tension throughout)
    if (avgTension < 3) {
      results.flow.push({
        type: 'flow',
        severity: 'consider',
        description: 'Low tension suggests passive sequence',
        textSpan: [0, 100],
        affectedScenes: window.map(s => s.id),
        pattern: 'passive_sequence'
      });
    }

    return results;
  }

  /**
   * Consolidate and deduplicate results across windows
   */
  private consolidateResults(results: SequenceResults): SequenceResults {
    const seenFlow = new Set<string>();
    const seenPacing = new Set<string>();
    const seenTheme = new Set<string>();
  
    const dedupeFlow = (items: NarrativeFlowIssue[]): NarrativeFlowIssue[] => {
      return items.filter(item => {
        const key = `${item.description}:${[...item.affectedScenes].sort().join(',')}:${item.pattern}`;
        if (seenFlow.has(key)) return false;
        seenFlow.add(key);
        return true;
      });
    };
  
    const dedupePacing = (items: PacingIssue[]): PacingIssue[] => {
      return items.filter(item => {
        const key = `${item.description}:${[...item.affectedScenes].sort().join(',')}:${item.pattern}:${item.tensionDelta}`;
        if (seenPacing.has(key)) return false;
        seenPacing.add(key);
        return true;
      });
    };
  
    const dedupeTheme = (items: ThematicDiscontinuity[]): ThematicDiscontinuity[] => {
      return items.filter(item => {
        const key = `${item.description}:${item.theme}:${item.lastSeenScene}:${item.brokenAtScene}`;
        if (seenTheme.has(key)) return false;
        seenTheme.add(key);
        return true;
      });
    };
  
    return {
      flow: dedupeFlow(results.flow),
      pacing: dedupePacing(results.pacing),
      theme: dedupeTheme(results.theme)
    };
  }

  /**
   * Build reader context from window
   */
  private buildReaderContext(window: CompressedScene[]): ReaderKnowledge {
    const characters = new Set<string>();
    const establishedSettings: { name: string }[] = [];
    const seenLocations = new Set<string>();
  
    for (const scene of window) {
      (scene.metadata.characters ?? []).forEach(c => { if (c) characters.add(c); });
      for (const loc of (scene.metadata.locations ?? [])) {
        if (loc && !seenLocations.has(loc)) {
          establishedSettings.push({ name: loc });
          seenLocations.add(loc);
        }
      }
    }
  
    return {
      knownCharacters: characters,
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings
    };
  }

  /**
   * Create placeholder Scene object from CompressedScene
   */
  private createPlaceholderScene(compressed: CompressedScene): Scene {
    return {
      id: compressed.id,
      text: compressed.summary,
      wordCount: compressed.metadata.wordCount,
      position: compressed.position,
      originalPosition: compressed.position,
      characters: compressed.metadata.characters,
      timeMarkers: [],
      locationMarkers: compressed.metadata.locations,
      hasBeenMoved: false,
      rewriteStatus: 'pending'
    };
  }

  /**
   * Validate flow pattern
   */
  private validateFlowPattern(
    pattern: string
  ): 'broken_causality' | 'passive_sequence' | 'info_dump' | 'info_gap' {
    const normalized = String(pattern).toLowerCase().replace(/[\s\-_]/g, '_');
    const valid = ['broken_causality', 'passive_sequence', 'info_dump', 'info_gap'];
    
    if (valid.includes(normalized)) {
      return normalized as any;
    }
    
    if (normalized.includes('cause') || normalized.includes('causal')) return 'broken_causality';
    if (normalized.includes('passive')) return 'passive_sequence';
    if (normalized.includes('dump')) return 'info_dump';
    if (normalized.includes('gap')) return 'info_gap';
    
    return 'broken_causality';
  }

  /**
   * Validate pacing pattern
   */
  private validatePacingPattern(pattern: string): 'too_slow' | 'too_fast' | 'inconsistent' {
    const normalized = String(pattern).toLowerCase().replace(/[\s\-_]/g, '_');
    
    if (normalized.includes('slow')) return 'too_slow';
    if (normalized.includes('fast') || normalized.includes('rush')) return 'too_fast';
    
    return 'inconsistent';
  }

  /**
   * Validate severity
   */
  private validateSeverity(severity: string): IssueSeverity {
    const valid: IssueSeverity[] = ['must-fix', 'should-fix', 'consider'];
    const normalized = String(severity).toLowerCase();
    
    if (valid.includes(normalized as IssueSeverity)) {
      return normalized as IssueSeverity;
    }
    
    if (normalized.includes('critical') || normalized.includes('must')) return 'must-fix';
    if (normalized.includes('should') || normalized.includes('important')) return 'should-fix';
    
    return 'consider';
  }

  /**
   * Cancel ongoing analysis
   */
  cancel(): void {
    this.cancelled = true;
    console.debug('[SequenceAnalyzer] Analysis cancelled');
  }

  /**
   * Get models used for analysis
   */
  getModelsUsed(): Map<string, string> {
    return new Map(this.modelsUsed);
  }
}