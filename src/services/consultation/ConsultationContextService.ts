import type {
  Scene,
  Manuscript,
  ContinuityAnalysis,
  ReaderKnowledge,
  RewriteVersion,
  ConsultationContext
} from '../../shared/types';
import AnalysisCache from '../cache/AnalysisCache';

export interface ContextOptions {
  includeContinuityAnalysis: boolean;
  includeGlobalCoherence: boolean;
  includeRewriteHistory: boolean;
  upToSceneIndex?: number;
}

export class ConsultationContextService {
  private analysisCache?: AnalysisCache;

  constructor(options?: { enableCache?: boolean }) {
    if (options?.enableCache) {
      this.analysisCache = new AnalysisCache();
    }
  }

  async buildContext(
    sceneIds: string[],
    manuscript: Manuscript,
    options: ContextOptions
  ): Promise<ConsultationContext> {
    if (!manuscript || !manuscript.scenes || !Array.isArray(manuscript.scenes)) {
      throw new Error('Invalid manuscript provided to buildContext');
    }

    if (!sceneIds || !Array.isArray(sceneIds) || sceneIds.length === 0) {
      throw new Error('At least one scene ID must be provided');
    }

    const selectedScenes = this.getSelectedScenes(sceneIds, manuscript.scenes);
    if (selectedScenes.length === 0) {
      throw new Error('No valid scenes found for the provided IDs');
    }

    const maxIndex = options.upToSceneIndex ?? this.getMaxSceneIndex(selectedScenes, manuscript.scenes);
    const scenesUpToIndex = manuscript.scenes.slice(0, maxIndex + 1);

    const readerKnowledge = this.extractReaderKnowledge(scenesUpToIndex, maxIndex);

    const [continuityAnalyses, rewriteHistory] = await Promise.all([
      options.includeContinuityAnalysis
        ? this.getRelatedAnalysis(sceneIds, selectedScenes)
        : Promise.resolve([]),
      options.includeRewriteHistory
        ? this.getRewriteHistory(sceneIds, selectedScenes)
        : Promise.resolve([])
    ]);

    const context: ConsultationContext = {
      selectedScenes,
      continuityAnalyses,
      readerKnowledge,
      globalCoherenceAnalysis: options.includeGlobalCoherence ? (manuscript as any).globalCoherenceAnalysis : undefined,
      rewriteHistory: rewriteHistory.length > 0 ? rewriteHistory : undefined
    };

    return context;
  }

  extractReaderKnowledge(scenes: Scene[], upToSceneIndex: number): ReaderKnowledge {
    const readerKnowledge: ReaderKnowledge = {
      knownCharacters: new Set<string>(),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: []
    };

    const scenesToProcess = scenes.slice(0, upToSceneIndex + 1);

    for (const scene of scenesToProcess) {
      if (scene.characters) {
        for (const character of scene.characters) {
          if (character && character.trim()) {
            readerKnowledge.knownCharacters.add(character.trim());
          }
        }
      }

      if (scene.timeMarkers) {
        for (const timeMarker of scene.timeMarkers) {
          if (timeMarker && timeMarker.trim()) {
            const timelineEvent = {
              label: timeMarker.trim(),
              sceneId: scene.id,
              type: 'relative' as const,
              relativeMarker: timeMarker.trim()
            };
            readerKnowledge.establishedTimeline.push(timelineEvent);
          }
        }
      }

      if (scene.locationMarkers) {
        for (const location of scene.locationMarkers) {
          if (location && location.trim()) {
            const existingSetting = readerKnowledge.establishedSettings.find(
              s => s.name.toLowerCase() === location.toLowerCase().trim()
            );
            if (!existingSetting) {
              readerKnowledge.establishedSettings.push({
                name: location.trim(),
                firstMentionedIn: scene.id,
                type: 'exterior'
              });
            }
          }
        }
      }

      if (scene.continuityAnalysis?.readerContext) {
        const sceneContext = scene.continuityAnalysis.readerContext;

        if (sceneContext.knownCharacters) {
          for (const char of sceneContext.knownCharacters) {
            readerKnowledge.knownCharacters.add(char);
          }
        }

        if (sceneContext.revealedPlotPoints) {
          for (const plotPoint of sceneContext.revealedPlotPoints) {
            if (plotPoint && !readerKnowledge.revealedPlotPoints.includes(plotPoint)) {
              readerKnowledge.revealedPlotPoints.push(plotPoint);
            }
          }
        }

        if (sceneContext.establishedTimeline) {
          for (const timeEvent of sceneContext.establishedTimeline) {
            const existingEvent = readerKnowledge.establishedTimeline.find(
              e => e.label === timeEvent.label || e.id === timeEvent.id
            );
            if (!existingEvent && timeEvent.label) {
              readerKnowledge.establishedTimeline.push({ ...timeEvent });
            }
          }
        }

        if (sceneContext.establishedSettings) {
          for (const setting of sceneContext.establishedSettings) {
            const existingSetting = readerKnowledge.establishedSettings.find(
              s => s.name.toLowerCase() === setting.name.toLowerCase()
            );
            if (!existingSetting) {
              readerKnowledge.establishedSettings.push({ ...setting });
            }
          }
        }
      }
    }

    return readerKnowledge;
  }

  async getRelatedAnalysis(sceneIds: string[], selectedScenes: Scene[]): Promise<ContinuityAnalysis[]> {
    const analyses: ContinuityAnalysis[] = [];

    if (this.analysisCache) {
      try {
        await this.ensureCacheInit();
      } catch (error) {
        console.debug('[ConsultationContextService] Cache initialization failed, proceeding without cache:', error);
      }
    }

    for (const scene of selectedScenes) {
      let analysis: ContinuityAnalysis | null = null;

      if (scene.continuityAnalysis) {
        analysis = scene.continuityAnalysis;
      } else if (this.analysisCache) {
        try {
          const emptyReaderContext: ReaderKnowledge = {
            knownCharacters: new Set<string>(),
            establishedTimeline: [],
            revealedPlotPoints: [],
            establishedSettings: []
          };

          const position = scene.position ?? 0;
          analysis = await this.analysisCache.get(scene, position, [], emptyReaderContext);
        } catch (error) {
          console.debug(`[ConsultationContextService] Cache lookup failed for scene ${scene.id}:`, error);
        }
      }

      if (analysis) {
        analyses.push(analysis);
      }
    }

    return analyses;
  }

  private getSelectedScenes(sceneIds: string[], allScenes: Scene[]): Scene[] {
    const sceneMap = new Map<string, Scene>();
    for (const scene of allScenes) {
      if (scene.id) {
        sceneMap.set(scene.id, scene);
      }
    }

    const selectedScenes: Scene[] = [];
    for (const id of sceneIds) {
      const scene = sceneMap.get(id);
      if (scene) {
        selectedScenes.push(scene);
      }
    }

    selectedScenes.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    return selectedScenes;
  }

  private getMaxSceneIndex(selectedScenes: Scene[], allScenes: Scene[]): number {
    let maxIndex = 0;

    for (const selectedScene of selectedScenes) {
      const index = allScenes.findIndex(scene => scene.id === selectedScene.id);
      if (index > maxIndex) {
        maxIndex = index;
      }
    }

    return maxIndex;
  }

  private async getRewriteHistory(sceneIds: string[], selectedScenes: Scene[]): Promise<RewriteVersion[]> {
    const rewriteHistory: RewriteVersion[] = [];

    for (const scene of selectedScenes) {
      if (scene.rewriteHistory && Array.isArray(scene.rewriteHistory)) {
        for (const rewrite of scene.rewriteHistory) {
          if (rewrite.sceneId && sceneIds.includes(rewrite.sceneId)) {
            rewriteHistory.push(rewrite);
          }
        }
      }
    }

    rewriteHistory.sort((a, b) => b.timestamp - a.timestamp);

    return rewriteHistory;
  }

  private async ensureCacheInit(): Promise<void> {
    if (!this.analysisCache) return;
    if ((this as any)._cacheInitialized) return;

    await this.analysisCache.init();
    (this as any)._cacheInitialized = true;
  }
}

export default ConsultationContextService;