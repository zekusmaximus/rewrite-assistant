import SceneRewriter from './SceneRewriter';
import type { Scene, ReaderKnowledge } from '../../shared/types';
import type { RewriteResult } from './SceneRewriter';
import AIServiceManager from '../ai/AIServiceManager';

export interface BatchRewriteProgress {
  totalScenes: number;
  completedScenes: number;
  currentSceneId?: string;
  currentSceneTitle?: string;
  phase: 'preparing' | 'analyzing' | 'rewriting' | 'complete' | 'error';
  message: string;
  results: Map<string, RewriteResult>;
  errors: Map<string, string>;
}

export interface BatchRewriteOptions {
  sceneIds?: string[];  // Specific scenes, or all moved if not provided
  skipIfNoIssues?: boolean;
  preserveElements?: Map<string, string[]>; // Per-scene preservation
  progressCallback?: (progress: BatchRewriteProgress) => void;
}

class RewriteOrchestrator {
  private sceneRewriter: SceneRewriter;
  private aiManager: AIServiceManager;
  private currentBatch?: AbortController;

  constructor(aiManager?: AIServiceManager) {
    this.aiManager = aiManager || new AIServiceManager();
    this.sceneRewriter = new SceneRewriter(this.aiManager);
  }

  /**
   * Rewrite multiple moved scenes in dependency order
   */
  async rewriteMovedScenes(
    manuscript: { scenes: Scene[]; currentOrder: string[] },
    options: BatchRewriteOptions = {}
  ): Promise<BatchRewriteProgress> {
    // Cancel any existing batch
    this.cancelBatch();
    this.currentBatch = new AbortController();

    const progress: BatchRewriteProgress = {
      totalScenes: 0,
      completedScenes: 0,
      phase: 'preparing',
      message: 'Preparing batch rewrite...',
      results: new Map(),
      errors: new Map()
    };

    try {
      // Step 1: Identify scenes to rewrite
      const scenesToRewrite = this.identifyScenesToRewrite(manuscript, options);
      progress.totalScenes = scenesToRewrite.length;

      if (scenesToRewrite.length === 0) {
        progress.phase = 'complete';
        progress.message = 'No scenes need rewriting';
        return progress;
      }

      // Step 2: Order scenes by dependency (narrative) order
      const orderedScenes = this.orderByDependency(scenesToRewrite, manuscript.currentOrder);

      progress.phase = 'analyzing';
      progress.message = `Analyzing ${scenesToRewrite.length} scenes...`;
      options.progressCallback?.(progress);

      // Step 3: Process each scene
      for (const sceneId of orderedScenes) {
        if (this.currentBatch?.signal.aborted) {
          progress.phase = 'error';
          progress.message = 'Batch rewrite cancelled';
          break;
        }

        const scene = manuscript.scenes.find(s => s.id === sceneId);
        if (!scene) {
          progress.errors.set(sceneId, 'Scene not found');
          progress.completedScenes++;
          options.progressCallback?.(progress);
          continue;
        }

        progress.currentSceneId = sceneId;
        progress.currentSceneTitle = this.getSceneTitle(scene);
        progress.phase = 'rewriting';
        progress.message = `Rewriting scene ${progress.completedScenes + 1} of ${progress.totalScenes}`;
        options.progressCallback?.(progress);

        try {
          // Get issues from analysis
          const issues = scene.continuityAnalysis?.issues || [];
          if (options.skipIfNoIssues && issues.length === 0) {
            progress.completedScenes++;
            continue;
          }

          // Build reader context from previous scenes
          const readerContext = this.buildReaderContext(
            manuscript,
            sceneId,
            progress.results
          );

          // Get previous scenes (including any already rewritten)
          const previousScenes = this.getPreviousScenes(
            manuscript,
            sceneId,
            progress.results
          );

          // Rewrite the scene
          const result = await this.sceneRewriter.rewriteScene({
            scene,
            issuesFound: issues,
            readerContext,
            previousScenes,
            preserveElements: options.preserveElements?.get(sceneId) || []
          });

          if (result.success) {
            progress.results.set(sceneId, result);
          } else {
            progress.errors.set(sceneId, result.error || 'Unknown error');
          }
        } catch (error) {
           
          console.error(`[RewriteOrchestrator] Failed to rewrite scene ${sceneId}:`, error);
          progress.errors.set(sceneId, error instanceof Error ? error.message : 'Unknown error');
        }

        progress.completedScenes++;
        options.progressCallback?.(progress);

        // Add small delay between scenes to prevent rate limiting
        if (progress.completedScenes < progress.totalScenes) {
          await this.delay(500);
        }
      }

      progress.phase = progress.errors.size > 0 ? 'error' : 'complete';
      progress.message = this.generateCompletionMessage(progress);

    } catch (error) {
       
      console.error('[RewriteOrchestrator] Batch rewrite error:', error);
      progress.phase = 'error';
      progress.message = 'Batch rewrite failed';
    }

    this.currentBatch = undefined;
    return progress;
  }

  /**
   * Cancel the current batch operation
   */
  cancelBatch(): void {
    if (this.currentBatch) {
      this.currentBatch.abort();
    }
  }

  private identifyScenesToRewrite(
    manuscript: { scenes: Scene[] },
    options: BatchRewriteOptions
  ): string[] {
    if (options.sceneIds) {
      return options.sceneIds;
    }

    // Default: all moved scenes with issues
    return manuscript.scenes
      .filter(scene =>
        scene.hasBeenMoved &&
        !!scene.continuityAnalysis?.issues &&
        scene.continuityAnalysis.issues.length > 0
      )
      .map(scene => scene.id);
  }

  private orderByDependency(
    sceneIds: string[],
    currentOrder: string[]
  ): string[] {
    // Process scenes in their current narrative order
    // This ensures reader context builds correctly
    return sceneIds.sort((a, b) => {
      const aIndex = currentOrder.indexOf(a);
      const bIndex = currentOrder.indexOf(b);
      return aIndex - bIndex;
    });
  }

  private buildReaderContext(
    manuscript: { scenes: Scene[]; currentOrder: string[] },
    sceneId: string,
    rewrittenScenes: Map<string, RewriteResult>
  ): ReaderKnowledge {
    const context: ReaderKnowledge = {
      knownCharacters: new Set<string>(),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: []
    };

    const sceneIndex = manuscript.currentOrder.indexOf(sceneId);
    if (sceneIndex <= 0) return context;

    // Include all scenes before this one
    for (let i = 0; i < sceneIndex; i++) {
      const prevSceneId = manuscript.currentOrder[i];
      const prevScene = manuscript.scenes.find(s => s.id === prevSceneId);
      if (!prevScene) continue;

      // Use rewritten version if available
      const rewritten = rewrittenScenes.get(prevSceneId);
      if (rewritten && rewritten.rewrittenText) {
        // For now, use original metadata; could extract from rewritten text later
        prevScene.characters?.forEach(char => context.knownCharacters.add(char));
      } else {
        prevScene.characters?.forEach(char => context.knownCharacters.add(char));
        prevScene.timeMarkers?.forEach(marker => {
          context.establishedTimeline.push({ label: marker });
        });
        prevScene.locationMarkers?.forEach(loc => {
          context.establishedSettings.push({ name: loc });
        });
      }
    }

    return context;
  }

  private getPreviousScenes(
    manuscript: { scenes: Scene[]; currentOrder: string[] },
    sceneId: string,
    rewrittenScenes: Map<string, RewriteResult>
  ): Scene[] {
    const sceneIndex = manuscript.currentOrder.indexOf(sceneId);
    if (sceneIndex <= 0) return [];

    // Get last 3 scenes before this one
    const startIndex = Math.max(0, sceneIndex - 3);
    const previousScenes: Scene[] = [];

    for (let i = startIndex; i < sceneIndex; i++) {
      const prevSceneId = manuscript.currentOrder[i];
      const prevScene = manuscript.scenes.find(s => s.id === prevSceneId);
      if (!prevScene) continue;

      // Use rewritten version if available
      const rewritten = rewrittenScenes.get(prevSceneId);
      if (rewritten && rewritten.rewrittenText) {
        previousScenes.push({
          ...prevScene,
          text: rewritten.rewrittenText,
          currentRewrite: rewritten.rewrittenText
        });
      } else {
        previousScenes.push(prevScene);
      }
    }

    return previousScenes;
  }

  private getSceneTitle(scene: Scene): string {
    // Try to extract a title from the scene
    const firstLine = (scene.text || '').split('\n')[0];
    if (firstLine && firstLine.length < 100) {
      return firstLine;
    }
    return `Scene ${scene.position + 1}`;
  }

  private generateCompletionMessage(progress: BatchRewriteProgress): string {
    const successful = progress.completedScenes - progress.errors.size;

    if (progress.errors.size === 0) {
      return `Successfully rewrote ${successful} scene${successful !== 1 ? 's' : ''}`;
    } else if (successful === 0) {
      return `Failed to rewrite ${progress.errors.size} scene${progress.errors.size !== 1 ? 's' : ''}`;
    } else {
      return `Rewrote ${successful} scene${successful !== 1 ? 's' : ''}, ${progress.errors.size} failed`;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default RewriteOrchestrator;