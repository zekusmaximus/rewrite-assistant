// src/services/rewrite/SceneRewriter.ts

/**
 * Phase 3.1 — SceneRewriter
 * Vision Compliance:
 * - Single rewrite only (no alternatives, no ranking)
 * - Fix ONLY identified issues; no optimization or stylistic "improvements"
 * - Preserve author's voice and story elements not tied to the issues
 */

import AIServiceManager from '../ai/AIServiceManager';
import type {
  Scene,
  ContinuityIssue,
  ReaderKnowledge,
} from '../../shared/types';
import type { AnalysisRequest } from '../ai/types';
import type { AnalysisRequestExtension } from '../ai/types';
import { enrichAnalysisRequest, runRewriteWithOptionalConsensus } from '../ai/consensus/ConsensusAdapter';

export interface RewriteRequest {
  scene: Scene;
  issuesFound: ContinuityIssue[];        // Issues from Phase 2 analysis
  readerContext: ReaderKnowledge;        // What the reader knows at new position
  previousScenes: Scene[];               // For context (max 3 scenes)
  preserveElements: string[];            // Elements that MUST stay unchanged
}

export interface RewriteResult {
  success: boolean;
  rewrittenText?: string;
  issuesAddressed: ContinuityIssue[];    // Which issues were actually fixed
  changesExplanation: string;            // Human-readable explanation
  preservedElements: string[];           // What was kept intact
  diffData: DiffSegment[];               // For UI display (basic placeholder for 3.1)
  error?: string;
  modelUsed?: string;
}

export interface DiffSegment {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  reason?: string;                       // Links to specific issue
  issueId?: string;                      // References ContinuityIssue
}

class SceneRewriter {
  private aiManager: AIServiceManager;

  // Retry handling
  private retryCount = new Map<string, number>();
  private maxRetries = 3;

  constructor(aiManager?: AIServiceManager) {
    // Use provided manager or create new instance
    this.aiManager = aiManager || new AIServiceManager();
  }

  async rewriteScene(request: RewriteRequest): Promise<RewriteResult> {
    try {
      // Validate request
      if (!request?.scene || !request.issuesFound || request.issuesFound.length === 0) {
        return {
          success: false,
          issuesAddressed: [],
          changesExplanation: 'No issues to fix',
          preservedElements: [],
          diffData: [],
          error: 'Invalid request: no scene or issues provided',
        };
      }

      // Build prompt based on issue types (strict: fix issues only)
      const prompt = this.buildRewritePrompt(request);

      // Select model based on complexity
      const analysisType = this.determineAnalysisType(request.issuesFound);

      // Create analysis request for AIServiceManager (intersection with extension)
      const baseRequest: AnalysisRequest & AnalysisRequestExtension = {
        scene: request.scene,
        previousScenes: request.previousScenes.slice(-3), // Limit context
        analysisType,
        readerContext: request.readerContext,
        customPrompt: prompt,
        isRewriteRequest: true,
        preserveElements: request.preserveElements,
      };

      // Enrich request locally with stable taskType and meta; preserve PromptCache identity
      const enriched = enrichAnalysisRequest(baseRequest as any, {
        scene: request.scene,
        detectorType: 'continuity_rewrite',
        flags: { critical: this.isCriticalRewrite(request) },
      });

      // Run single model or consensus depending on criticality
      const response = await runRewriteWithOptionalConsensus(this.aiManager, enriched as any, {
        critical: Boolean((enriched as any)?.flags?.critical),
        consensusCount: 2,
        acceptThreshold: 0.5,
        humanReviewThreshold: 0.9,
        maxModels: 2,
      });

      // Parse and structure the response
      return this.parseRewriteResponse(
        response,
        request.scene.text || '',
        request.issuesFound
      );

    } catch (error) {
      // Ensure original text is not lost; fail safely with structured error
      // eslint-disable-next-line no-console
      console.error('[SceneRewriter] Rewrite failed:', error);
      return {
        success: false,
        issuesAddressed: [],
        changesExplanation: 'Rewrite generation failed',
        preservedElements: [],
        diffData: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildRewritePrompt(request: RewriteRequest): string {
    // Build a focused prompt that:
    // 1. Lists specific issues to fix
    // 2. Provides reader context
    // 3. Specifies preservation constraints
    // 4. Requests structured output (single rewrite only)

    const issuesList = request.issuesFound
      .map((i) => `- ${i.type}: ${i.description}`)
      .join('\n');

    const knownChars = Array.from(request.readerContext.knownCharacters || []).join(', ');
    const timeline = (request.readerContext.establishedTimeline || [])
      .map((t: any) => t?.label)
      .filter(Boolean)
      .join(', ');
    const plotPoints = (request.readerContext.revealedPlotPoints || []).join(', ');

    const preserveList =
      request.preserveElements && request.preserveElements.length > 0
        ? `Preserve these elements exactly:\n${request.preserveElements.join('\n')}`
        : '';

    return `Rewrite this scene to fix continuity issues for its new position.

CURRENT SCENE TEXT:
${request.scene.text}

ISSUES TO FIX:
${issuesList}

READER CONTEXT AT NEW POSITION:
- Known characters: ${knownChars}
- Established timeline: ${timeline}
- Revealed plot points: ${plotPoints}

${preserveList}

STRICT REQUIREMENTS:
1. Fix ONLY the identified issues listed above.
2. Preserve the author's voice and style.
3. Keep all story elements not related to the issues.
4. Make the minimal changes necessary.
5. Return ONLY the rewritten scene text (no commentary, no lists, no alternatives).

Hard constraints:
- Do NOT add new plot elements.
- Do NOT optimize the prose beyond what is strictly required to fix the issues.
- Do NOT rank or compare options.
- Produce ONE rewrite only.`;
  }

  private determineAnalysisType(issues: ContinuityIssue[]): AnalysisRequest['analysisType'] {
    // Route to appropriate model based on issue complexity
    const hasMustFix = issues.some((i) => i.severity === 'must-fix');
    const hasComplexIssues = issues.some((i) => i.type === 'character' || i.type === 'plot');

    if (hasMustFix && hasComplexIssues) {
      return 'complex';      // e.g., high-capability model
    } else if (hasComplexIssues) {
      return 'consistency';  // e.g., mid-capability model
    } else {
      return 'simple';       // e.g., cost-effective model
    }
  }

  // Local heuristic to decide if rewrite should use consensus
  // - Explicit scene flag: (scene as any).critical === true
  // - Or multiple must-fix issues
  // - Or dependencies across >= 2 previous scenes
  private isCriticalRewrite(req: RewriteRequest): boolean {
    if ((req.scene as any)?.critical === true) return true;
    const mustFixCount = req.issuesFound.filter(i => i.severity === 'must-fix').length;
    if (mustFixCount >= 2) return true;
    if ((req.previousScenes?.length ?? 0) >= 2) return true;
    return false;
  }

  private parseRewriteResponse(
    response: any,
    originalText: string,
    issues: ContinuityIssue[]
  ): RewriteResult {
    // Parse AI response and create structured result (defensive)
    const rewrittenText: string =
      response?.rewrittenText ??
      response?.content?.[0]?.text ??
      response?.text ??
      '';

    if (!rewrittenText || typeof rewrittenText !== 'string') {
      return {
        success: false,
        issuesAddressed: [],
        changesExplanation: 'No rewrite generated',
        preservedElements: [],
        diffData: [],
        error: 'AI response did not contain rewritten text',
      };
    }

    // Generate diff data (placeholder for Phase 3.1 — see DiffEngine in Task 5)
    const diffData = this.generateBasicDiff(originalText, rewrittenText);

    return {
      success: true,
      rewrittenText,
      issuesAddressed: issues, // Assume all addressed for Phase 3.1; refine later
      changesExplanation: this.generateExplanation(issues),
      preservedElements: [], // Preservation detection to be added in later phases
      diffData,
      modelUsed: response?.modelUsed || response?.meta?.model || 'unknown',
    };
  }

  private generateBasicDiff(original: string, rewritten: string): DiffSegment[] {
    // Placeholder — minimal diff to satisfy Phase 3.1 requirements.
    if (original === rewritten) {
      return [
        {
          type: 'unchanged',
          text: rewritten,
          reason: 'No changes detected',
        },
      ];
    }

    // Show single "unchanged" placeholder segment to avoid implying ranking/alternatives.
    return [
      {
        type: 'unchanged',
        text: rewritten,
        reason: 'Full diff pending DiffEngine implementation in Task 5',
      },
    ];
  }

  private generateExplanation(issues: ContinuityIssue[]): string {
    const fixes = issues.map((i) => {
      switch (i.type) {
        case 'pronoun':
          return 'Clarified pronoun references';
        case 'character':
          return 'Added/clarified character context appropriate to new position';
        case 'timeline':
          return 'Adjusted temporal markers for continuity';
        case 'plot':
          return 'Inserted necessary plot context revealed in prior scenes';
        case 'engagement':
          return 'Adjusted opening lines to maintain engagement after reorder';
        default:
          return `Addressed ${i.type} continuity issue`;
      }
    });

    // Join with semicolons to form a single human-readable sentence
    return fixes.join('; ');
  }
async rewriteSceneWithRetry(request: RewriteRequest): Promise<RewriteResult> {
    const sceneId = request.scene.id;
    let lastError: Error | null = null;
  
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Clear any previous errors
        lastError = null;
        
        // Exponential backoff
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.delay(delay);
        }
        
        // Attempt rewrite
        const result = await this.rewriteScene(request);
        
        if (result.success) {
          this.retryCount.delete(sceneId);
          return result;
        }
        
        // If not successful but no error, don't retry
        if (!result.error || result.error.includes('No issues')) {
          return result;
        }
        
        lastError = new Error(result.error);

        if (!this.isRetryableError(lastError)) {
          break;
        }
      } catch (error) {
        console.warn(`[SceneRewriter] Attempt ${attempt + 1} failed:`, error);
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
          break;
        }
      }
    }
    
    // All retries exhausted
    return {
      success: false,
      issuesAddressed: [],
      changesExplanation: '',
      preservedElements: [],
      diffData: [],
      error: `Failed after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    };
  }

  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Don't retry on these errors
    const nonRetryable = [
      'invalid api key',
      'no issues',
      'invalid request',
      'scene not found'
    ];
    
    return !nonRetryable.some(phrase => message.includes(phrase));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
  
export default SceneRewriter;