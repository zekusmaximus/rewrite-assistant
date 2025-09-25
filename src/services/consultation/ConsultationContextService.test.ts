import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Scene,
  Manuscript,
  ContinuityAnalysis,
  ReaderKnowledge,
  GlobalCoherenceAnalysis,
  RewriteVersion,
  Location
} from '../../shared/types';
import ConsultationContextService, { ContextOptions } from './ConsultationContextService';
import AnalysisCache from '../cache/AnalysisCache';

vi.mock('../cache/AnalysisCache');

function createMockScene(
  id: string,
  position: number,
  text: string = 'Sample scene text',
  overrides: Partial<Scene> = {}
): Scene {
  return {
    id,
    text,
    wordCount: text.split(' ').length,
    position,
    originalPosition: position,
    characters: overrides.characters || [],
    timeMarkers: overrides.timeMarkers || [],
    locationMarkers: overrides.locationMarkers || [],
    hasBeenMoved: false,
    rewriteStatus: 'pending',
    ...overrides
  };
}

function createMockManuscript(scenes: Scene[], overrides: Partial<Manuscript> = {}): Manuscript {
  return {
    id: 'test-manuscript',
    title: 'Test Manuscript',
    scenes,
    originalOrder: scenes.map(s => s.id),
    currentOrder: scenes.map(s => s.id),
    ...overrides
  };
}

function createMockReaderKnowledge(overrides: Partial<ReaderKnowledge> = {}): ReaderKnowledge {
  return {
    knownCharacters: new Set<string>(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
    ...overrides
  };
}

function createMockContinuityAnalysis(
  sceneId: string,
  overrides: Partial<ContinuityAnalysis> = {}
): ContinuityAnalysis {
  return {
    issues: [],
    timestamp: Date.now(),
    modelUsed: 'test-model',
    confidence: 0.8,
    readerContext: createMockReaderKnowledge(),
    ...overrides
  };
}

function createMockRewriteVersion(
  sceneId: string,
  overrides: Partial<RewriteVersion> = {}
): RewriteVersion {
  return {
    id: `rewrite-${sceneId}-1`,
    sceneId,
    timestamp: Date.now(),
    rewrittenText: 'Rewritten scene text',
    issuesAddressed: [],
    changesExplanation: 'Test rewrite',
    modelUsed: 'test-model',
    userEdited: false,
    appliedToManuscript: false,
    ...overrides
  };
}

describe('ConsultationContextService', () => {
  let service: ConsultationContextService;
  let mockCache: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCache = {
      init: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null)
    };
    (AnalysisCache as any).mockImplementation(() => mockCache);
  });

  describe('constructor', () => {
    it('should create service without cache by default', () => {
      service = new ConsultationContextService();
      expect(service).toBeDefined();
      expect(AnalysisCache).not.toHaveBeenCalled();
    });

    it('should create service with cache when enabled', () => {
      service = new ConsultationContextService({ enableCache: true });
      expect(service).toBeDefined();
      expect(AnalysisCache).toHaveBeenCalledOnce();
    });
  });

  describe('buildContext', () => {
    beforeEach(() => {
      service = new ConsultationContextService();
    });

    it('should throw error for invalid manuscript', async () => {
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: false
      };

      await expect(
        service.buildContext(['scene1'], null as any, options)
      ).rejects.toThrow('Invalid manuscript provided to buildContext');
    });

    it('should throw error for empty scene IDs', async () => {
      const manuscript = createMockManuscript([]);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: false
      };

      await expect(
        service.buildContext([], manuscript, options)
      ).rejects.toThrow('At least one scene ID must be provided');
    });

    it('should throw error when no valid scenes found', async () => {
      const scenes = [createMockScene('scene1', 0)];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: false
      };

      await expect(
        service.buildContext(['nonexistent'], manuscript, options)
      ).rejects.toThrow('No valid scenes found for the provided IDs');
    });

    it('should build basic context without optional data', async () => {
      const scenes = [
        createMockScene('scene1', 0, 'First scene'),
        createMockScene('scene2', 1, 'Second scene')
      ];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: false
      };

      const context = await service.buildContext(['scene1', 'scene2'], manuscript, options);

      expect(context.selectedScenes).toHaveLength(2);
      expect(context.selectedScenes[0].id).toBe('scene1');
      expect(context.selectedScenes[1].id).toBe('scene2');
      expect(context.continuityAnalyses).toEqual([]);
      expect(context.readerKnowledge).toBeDefined();
      expect(context.readerKnowledge.knownCharacters.size).toBe(0);
      expect(context.globalCoherenceAnalysis).toBeUndefined();
      expect(context.rewriteHistory).toBeUndefined();
    });

    it('should include global coherence analysis when requested', async () => {
      const scenes = [createMockScene('scene1', 0)];
      const globalCoherence = {} as GlobalCoherenceAnalysis;
      const manuscript = createMockManuscript(scenes, { globalCoherenceAnalysis: globalCoherence } as any);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: true,
        includeRewriteHistory: false
      };

      const context = await service.buildContext(['scene1'], manuscript, options);

      expect(context.globalCoherenceAnalysis).toBe(globalCoherence);
    });

    it('should limit scenes to upToSceneIndex when specified', async () => {
      const scenes = [
        createMockScene('scene1', 0, 'First', { characters: ['Alice'] }),
        createMockScene('scene2', 1, 'Second', { characters: ['Bob'] }),
        createMockScene('scene3', 2, 'Third', { characters: ['Charlie'] })
      ];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: false,
        upToSceneIndex: 1
      };

      const context = await service.buildContext(['scene3'], manuscript, options);

      expect(context.readerKnowledge.knownCharacters.has('Charlie')).toBe(false);
      expect(context.readerKnowledge.knownCharacters.has('Alice')).toBe(true);
      expect(context.readerKnowledge.knownCharacters.has('Bob')).toBe(true);
    });
  });

  describe('extractReaderKnowledge', () => {
    beforeEach(() => {
      service = new ConsultationContextService();
    });

    it('should extract characters from scene metadata', () => {
      const scenes = [
        createMockScene('scene1', 0, 'Text', { characters: ['Alice', 'Bob'] }),
        createMockScene('scene2', 1, 'Text', { characters: ['Charlie', 'Alice'] })
      ];

      const knowledge = service.extractReaderKnowledge(scenes, 1);

      expect(knowledge.knownCharacters.has('Alice')).toBe(true);
      expect(knowledge.knownCharacters.has('Bob')).toBe(true);
      expect(knowledge.knownCharacters.has('Charlie')).toBe(true);
      expect(knowledge.knownCharacters.size).toBe(3);
    });

    it('should extract timeline events from time markers', () => {
      const scenes = [
        createMockScene('scene1', 0, 'Text', { timeMarkers: ['Morning', 'Next day'] }),
        createMockScene('scene2', 1, 'Text', { timeMarkers: ['Evening'] })
      ];

      const knowledge = service.extractReaderKnowledge(scenes, 1);

      expect(knowledge.establishedTimeline).toHaveLength(3);
      expect(knowledge.establishedTimeline[0].label).toBe('Morning');
      expect(knowledge.establishedTimeline[0].sceneId).toBe('scene1');
      expect(knowledge.establishedTimeline[1].label).toBe('Next day');
      expect(knowledge.establishedTimeline[2].label).toBe('Evening');
    });

    it('should extract locations from location markers', () => {
      const scenes = [
        createMockScene('scene1', 0, 'Text', { locationMarkers: ['Kitchen', 'Garden'] }),
        createMockScene('scene2', 1, 'Text', { locationMarkers: ['Kitchen', 'Bedroom'] })
      ];

      const knowledge = service.extractReaderKnowledge(scenes, 1);

      expect(knowledge.establishedSettings).toHaveLength(3);
      expect(knowledge.establishedSettings.find(s => s.name === 'Kitchen')).toBeDefined();
      expect(knowledge.establishedSettings.find(s => s.name === 'Garden')).toBeDefined();
      expect(knowledge.establishedSettings.find(s => s.name === 'Bedroom')).toBeDefined();
    });

    it('should merge from continuity analysis when available', () => {
      const continuityAnalysis = createMockContinuityAnalysis('scene1', {
        readerContext: createMockReaderKnowledge({
          knownCharacters: new Set(['David', 'Eve']),
          revealedPlotPoints: ['Secret revealed'],
          establishedSettings: [{ name: 'Library', type: 'interior' }] as Location[]
        })
      });

      const scenes = [
        createMockScene('scene1', 0, 'Text', {
          characters: ['Alice'],
          continuityAnalysis
        })
      ];

      const knowledge = service.extractReaderKnowledge(scenes, 0);

      expect(knowledge.knownCharacters.has('Alice')).toBe(true);
      expect(knowledge.knownCharacters.has('David')).toBe(true);
      expect(knowledge.knownCharacters.has('Eve')).toBe(true);
      expect(knowledge.revealedPlotPoints).toContain('Secret revealed');
      expect(knowledge.establishedSettings.find(s => s.name === 'Library')).toBeDefined();
    });

    it('should handle empty or invalid data gracefully', () => {
      const scenes = [
        createMockScene('scene1', 0, 'Text', {
          characters: ['', null as any, '  ', 'Alice'],
          timeMarkers: ['', null as any, 'Morning'],
          locationMarkers: ['', null as any, '  ', 'Kitchen']
        })
      ];

      const knowledge = service.extractReaderKnowledge(scenes, 0);

      expect(knowledge.knownCharacters.size).toBe(1);
      expect(knowledge.knownCharacters.has('Alice')).toBe(true);
      expect(knowledge.establishedTimeline).toHaveLength(1);
      expect(knowledge.establishedTimeline[0].label).toBe('Morning');
      expect(knowledge.establishedSettings).toHaveLength(1);
      expect(knowledge.establishedSettings[0].name).toBe('Kitchen');
    });
  });

  describe('getRelatedAnalysis', () => {
    beforeEach(() => {
      service = new ConsultationContextService({ enableCache: true });
    });

    it('should return analysis from scene metadata when available', async () => {
      const analysis = createMockContinuityAnalysis('scene1');
      const scenes = [
        createMockScene('scene1', 0, 'Text', { continuityAnalysis: analysis })
      ];

      const analyses = await service.getRelatedAnalysis(['scene1'], scenes);

      expect(analyses).toHaveLength(1);
      expect(analyses[0]).toBe(analysis);
    });

    it('should try cache when scene has no analysis', async () => {
      const cachedAnalysis = createMockContinuityAnalysis('scene1');
      mockCache.get.mockResolvedValue(cachedAnalysis);

      const scenes = [createMockScene('scene1', 0, 'Text')];

      const analyses = await service.getRelatedAnalysis(['scene1'], scenes);

      expect(mockCache.init).toHaveBeenCalled();
      expect(mockCache.get).toHaveBeenCalled();
      expect(analyses).toHaveLength(1);
      expect(analyses[0]).toBe(cachedAnalysis);
    });

    it('should handle cache errors gracefully', async () => {
      mockCache.init.mockRejectedValue(new Error('Cache init failed'));
      mockCache.get.mockRejectedValue(new Error('Cache get failed'));

      const scenes = [createMockScene('scene1', 0, 'Text')];

      const analyses = await service.getRelatedAnalysis(['scene1'], scenes);

      expect(analyses).toHaveLength(0);
    });

    it('should return empty array for scenes without analysis', async () => {
      const scenes = [createMockScene('scene1', 0, 'Text')];

      const analyses = await service.getRelatedAnalysis(['scene1'], scenes);

      expect(analyses).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      service = new ConsultationContextService();
    });

    it('should handle missing scene properties gracefully', async () => {
      const scenes = [
        {
          id: 'scene1',
          text: 'Text',
          wordCount: 1,
          position: 0,
          originalPosition: 0,
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        } as Scene
      ];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: false
      };

      const context = await service.buildContext(['scene1'], manuscript, options);

      expect(context.selectedScenes).toHaveLength(1);
      expect(context.readerKnowledge.knownCharacters.size).toBe(0);
    });

    it('should handle scenes with undefined IDs gracefully', async () => {
      const scenes = [
        { ...createMockScene('scene1', 0), id: undefined as any },
        createMockScene('scene2', 1)
      ];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: false
      };

      const context = await service.buildContext(['scene2'], manuscript, options);

      expect(context.selectedScenes).toHaveLength(1);
      expect(context.selectedScenes[0].id).toBe('scene2');
    });
  });

  describe('rewrite history', () => {
    beforeEach(() => {
      service = new ConsultationContextService();
    });

    it('should include rewrite history when requested', async () => {
      const rewrite = createMockRewriteVersion('scene1');
      const scenes = [
        createMockScene('scene1', 0, 'Text', { rewriteHistory: [rewrite] })
      ];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: true
      };

      const context = await service.buildContext(['scene1'], manuscript, options);

      expect(context.rewriteHistory).toHaveLength(1);
      expect(context.rewriteHistory![0]).toBe(rewrite);
    });

    it('should filter rewrite history to selected scenes only', async () => {
      const rewrite1 = createMockRewriteVersion('scene1');
      const rewrite2 = createMockRewriteVersion('scene2');
      const scenes = [
        createMockScene('scene1', 0, 'Text', { rewriteHistory: [rewrite1, rewrite2] }),
        createMockScene('scene2', 1, 'Text')
      ];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: true
      };

      const context = await service.buildContext(['scene1'], manuscript, options);

      expect(context.rewriteHistory).toHaveLength(1);
      expect(context.rewriteHistory![0].sceneId).toBe('scene1');
    });

    it('should sort rewrite history by timestamp descending', async () => {
      const oldRewrite = createMockRewriteVersion('scene1', { timestamp: 1000 });
      const newRewrite = createMockRewriteVersion('scene1', { timestamp: 2000 });
      const scenes = [
        createMockScene('scene1', 0, 'Text', { rewriteHistory: [oldRewrite, newRewrite] })
      ];
      const manuscript = createMockManuscript(scenes);
      const options: ContextOptions = {
        includeContinuityAnalysis: false,
        includeGlobalCoherence: false,
        includeRewriteHistory: true
      };

      const context = await service.buildContext(['scene1'], manuscript, options);

      expect(context.rewriteHistory).toHaveLength(2);
      expect(context.rewriteHistory![0].timestamp).toBe(2000);
      expect(context.rewriteHistory![1].timestamp).toBe(1000);
    });
  });
});