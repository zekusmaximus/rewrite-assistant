import { create } from 'zustand';
import type { RewriteVersion, DiffSegment, Scene } from '../../../../shared/types';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import { IPC_CHANNELS } from '../../../../shared/constants';
import DiffEngine from '../../../../services/rewrite/DiffEngine';
import RewriteOrchestrator from '../../../../services/rewrite/RewriteOrchestrator';
import type { BatchRewriteProgress, BatchRewriteOptions } from '../../../../services/rewrite/RewriteOrchestrator';

interface RewriteState {
  // Current rewrite operation state
  isRewriting: boolean;
  currentRewriteSceneId?: string;
  rewriteProgress: {
    stage: 'idle' | 'analyzing' | 'generating' | 'formatting' | 'complete' | 'error';
    message: string;
  };
  
  // Rewrite storage - Map<sceneId, RewriteVersion[]>
  sceneRewrites: Map<string, RewriteVersion[]>;
  
  // Active edits - Map<sceneId, edited text>
  activeEdits: Map<string, string>;
  
  // Diff data cache for performance
  diffCache: Map<string, DiffSegment[]>;

  // Batch operations
  batchProgress?: BatchRewriteProgress;
  isBatchRewriting: boolean;
  batchOrchestrator?: RewriteOrchestrator;
  batchCancelled: boolean;

  // History management
  showHistory: Map<string, boolean>;
  
  // Actions
  generateRewrite: (sceneId: string) => Promise<void>;
  loadRewriteForEdit: (sceneId: string) => void;
  updateEditedText: (sceneId: string, text: string) => void;
  saveEdit: (sceneId: string) => void;
  applyRewrite: (sceneId: string) => void;
  rejectRewrite: (sceneId: string) => void;
  clearRewrite: (sceneId: string) => void;

  // Batch actions
  startBatchRewrite: (options?: BatchRewriteOptions) => Promise<void>;
  cancelBatchRewrite: () => void;
  toggleHistory: (sceneId: string) => void;
  clearAllRewrites: () => void;
  getRewriteHistory: (sceneId: string) => RewriteVersion[];
  
  // Getters
  getLatestRewrite: (sceneId: string) => RewriteVersion | undefined;
  getEditedText: (sceneId: string) => string | undefined;
  getDiff: (sceneId: string) => DiffSegment[] | undefined;
  hasRewrite: (sceneId: string) => boolean;
  isEditing: (sceneId: string) => boolean;
}

const useRewriteStore = create<RewriteState>((set, get) => ({
  isRewriting: false,
  currentRewriteSceneId: undefined,
  rewriteProgress: {
    stage: 'idle',
    message: ''
  },
  sceneRewrites: new Map(),
  activeEdits: new Map(),
  diffCache: new Map(),

  // Batch defaults
  batchProgress: undefined,
  isBatchRewriting: false,
  batchOrchestrator: undefined,
  batchCancelled: false,

  // History UI tracking
  showHistory: new Map(),
  
  generateRewrite: async (sceneId: string) => {
    const manuscript = useManuscriptStore.getState().manuscript;
    const scene = manuscript?.scenes.find(s => s.id === sceneId);
    if (!scene || !scene.continuityAnalysis?.issues?.length) {
      console.warn('[RewriteStore] No scene or issues to rewrite');
      return;
    }

    // Ensure manuscript is loaded to satisfy TS nullability and runtime safety
    if (!manuscript) {
      console.warn('[RewriteStore] Manuscript not loaded');
      set({
        isRewriting: false,
        currentRewriteSceneId: undefined,
        rewriteProgress: { stage: 'error', message: 'No manuscript loaded' }
      });
      return;
    }
    
    set({
      isRewriting: true,
      currentRewriteSceneId: sceneId,
      rewriteProgress: { stage: 'analyzing', message: 'Analyzing issues...' }
    });
    
    try {
      // Get previous scenes for context
      const currentOrder = manuscript.currentOrder || [];
      const sceneIndex = currentOrder.indexOf(sceneId);
      const previousSceneIds = currentOrder.slice(Math.max(0, sceneIndex - 3), sceneIndex);
      const previousScenes = previousSceneIds
        .map(id => manuscript.scenes.find(s => s.id === id))
        .filter(Boolean) as Scene[];
      
      // Build reader context
      const readerContext = {
        knownCharacters: new Set<string>(),
        establishedTimeline: [] as Array<{ label: string }>,
        revealedPlotPoints: [] as string[],
        establishedSettings: [] as Array<{ name: string }>
      };
      
      previousScenes.forEach(s => {
        s.characters?.forEach(char => readerContext.knownCharacters.add(char));
        s.timeMarkers?.forEach(marker => {
          readerContext.establishedTimeline.push({ label: marker });
        });
        s.locationMarkers?.forEach(loc => {
          readerContext.establishedSettings.push({ name: loc });
        });
      });
      
      set({ rewriteProgress: { stage: 'generating', message: 'Generating rewrite...' } });
      
      // Call IPC handler (support both preload patterns)
      const ipcInvoke = (window as any)?.electron?.ipcRenderer?.invoke;
      if (!ipcInvoke || typeof ipcInvoke !== 'function') {
        throw new Error('IPC invoke not available. Ensure preload exposes ipcRenderer.invoke or adjust store.');
      }

      const result = await ipcInvoke(
        IPC_CHANNELS.GENERATE_REWRITE,
        {
          sceneId,
          scene,
          issues: scene.continuityAnalysis.issues,
          previousScenes,
          readerContext,
          preserveElements: []
        }
      );
      
      if (result.success && result.rewrittenText) {
        // Create RewriteVersion
        const rewriteVersion: RewriteVersion = {
          id: `${sceneId}-${Date.now()}`,
          sceneId,
          timestamp: Date.now(),
          rewrittenText: result.rewrittenText,
          issuesAddressed: result.issuesAddressed || [],
          changesExplanation: result.changesExplanation || '',
          modelUsed: result.modelUsed || 'unknown',
          userEdited: false,
          appliedToManuscript: false
        };
        
        // Update store
        set(state => {
          const rewrites = new Map(state.sceneRewrites);
          // Regenerate replaces existing rewrite for this scene (Phase 3.2 requirement)
          rewrites.set(sceneId, [rewriteVersion]);

          // Clear any active edit for this scene on regeneration
          const activeEdits = new Map(state.activeEdits);
          activeEdits.delete(sceneId);
          
          // Generate and cache diff
          const diffSegments = DiffEngine.generateDiff(scene.text, result.rewrittenText!,
            { granularity: 'word', includeReasons: true }
          );
          
          const diffCache = new Map(state.diffCache);
          diffCache.set(sceneId, diffSegments);
          
          return {
            sceneRewrites: rewrites,
            activeEdits,
            diffCache,
            rewriteProgress: { stage: 'complete', message: 'Rewrite generated successfully' }
          };
        });
        
        // Update manuscript store to mark scene as having a rewrite
        useManuscriptStore.getState().updateScene(sceneId, {
          rewriteStatus: 'generated',
          currentRewrite: result.rewrittenText
        });
        
      } else {
        set({ 
          rewriteProgress: { 
            stage: 'error', 
            message: result.error || 'Failed to generate rewrite' 
          } 
        });
      }
    } catch (error) {
      console.error('[RewriteStore] Generation error:', error);
      set({ 
        rewriteProgress: { 
          stage: 'error', 
          message: 'An error occurred while generating the rewrite' 
        } 
      });
    } finally {
      set({ isRewriting: false, currentRewriteSceneId: undefined });
    }
  },
  
  loadRewriteForEdit: (sceneId: string) => {
    const latest = get().getLatestRewrite(sceneId);
    if (latest) {
      set(state => {
        const edits = new Map(state.activeEdits);
        edits.set(sceneId, latest.rewrittenText);
        return { activeEdits: edits };
      });
    }
  },
  
  updateEditedText: (sceneId: string, text: string) => {
    set(state => {
      const edits = new Map(state.activeEdits);
      edits.set(sceneId, text);
      
      // Update diff cache with edited version
      const manuscript = useManuscriptStore.getState().manuscript;
      const scene = manuscript?.scenes.find(s => s.id === sceneId);
      if (scene) {
        const diffSegments = DiffEngine.generateDiff(
          scene.text,
          text,
          { granularity: 'word', includeReasons: true }
        );
        const diffCache = new Map(state.diffCache);
        diffCache.set(sceneId, diffSegments);
        return { activeEdits: edits, diffCache };
      }
      
      return { activeEdits: edits };
    });
  },
  
  saveEdit: (sceneId: string) => {
    const editedText = get().activeEdits.get(sceneId);
    const latest = get().getLatestRewrite(sceneId);
    
    if (!editedText || !latest) return;
    
    // Create new version marked as user-edited
    const editedVersion: RewriteVersion = {
      ...latest,
      id: `${sceneId}-edited-${Date.now()}`,
      rewrittenText: editedText,
      userEdited: true,
      timestamp: Date.now()
    };
    
    set(state => {
      const rewrites = new Map(state.sceneRewrites);
      const history = rewrites.get(sceneId) || [];
      rewrites.set(sceneId, [...history, editedVersion]);
      
      // Clear active edit
      const edits = new Map(state.activeEdits);
      edits.delete(sceneId);
      
      return { sceneRewrites: rewrites, activeEdits: edits };
    });
    
    // Update manuscript
    useManuscriptStore.getState().updateScene(sceneId, {
      currentRewrite: editedText
    });
  },
  
  applyRewrite: (sceneId: string) => {
    const latest = get().getLatestRewrite(sceneId);
    const editedText = get().activeEdits.get(sceneId);
    const finalText = editedText || latest?.rewrittenText;
    
    if (!finalText) return;
    
    // Update manuscript with rewritten text
    useManuscriptStore.getState().updateScene(sceneId, {
      text: finalText,
      rewriteStatus: 'approved',
      currentRewrite: undefined, // Clear temporary rewrite
      hasBeenMoved: false // Scene is now adapted to new position
    });
    
    // Mark as applied
    if (latest) {
      set(state => {
        const rewrites = new Map(state.sceneRewrites);
        const history = rewrites.get(sceneId) || [];
        if (history.length > 0) {
          history[history.length - 1].appliedToManuscript = true;
        }
        rewrites.set(sceneId, history);
        return { sceneRewrites: rewrites };
      });
    }
    
    // Clear active edit
    set(state => {
      const edits = new Map(state.activeEdits);
      edits.delete(sceneId);
      return { activeEdits: edits };
    });
  },
  
  rejectRewrite: (sceneId: string) => {
    // Update manuscript status
    useManuscriptStore.getState().updateScene(sceneId, {
      rewriteStatus: 'rejected',
      currentRewrite: undefined
    });
    
    // Clear active edit
    set(state => {
      const edits = new Map(state.activeEdits);
      edits.delete(sceneId);
      return { activeEdits: edits };
    });
  },
  
  clearRewrite: (sceneId: string) => {
    set(state => {
      const rewrites = new Map(state.sceneRewrites);
      rewrites.delete(sceneId);
      
      const edits = new Map(state.activeEdits);
      edits.delete(sceneId);
      
      const diffCache = new Map(state.diffCache);
      diffCache.delete(sceneId);
      
      return { sceneRewrites: rewrites, activeEdits: edits, diffCache };
    });
    
    // Reset scene status
    useManuscriptStore.getState().updateScene(sceneId, {
      rewriteStatus: 'pending',
      currentRewrite: undefined
    });
  },
  
  // Batch operations
  startBatchRewrite: async (options: BatchRewriteOptions = {}) => {
    const manuscript = useManuscriptStore.getState().manuscript;
    if (!manuscript) {
      console.warn('[RewriteStore] No manuscript for batch rewrite');
      return;
    }
    
    // Create orchestrator if needed
    let orchestrator = get().batchOrchestrator;
    if (!orchestrator) {
      orchestrator = new RewriteOrchestrator();
      set({ batchOrchestrator: orchestrator });
    }
    
    set({
      isBatchRewriting: true,
      batchCancelled: false,
      batchProgress: {
        totalScenes: 0,
        completedScenes: 0,
        phase: 'preparing',
        message: 'Starting batch rewrite...',
        results: new Map(),
        errors: new Map()
      }
    });
    
    try {
      // Set up progress callback
      const progressCallback = (progress: BatchRewriteProgress) => {
        set({ batchProgress: progress });
        
        // Update individual scene rewrites as they complete
        progress.results.forEach((result, sceneId) => {
          if (result.success && result.rewrittenText) {
            const rewriteVersion: RewriteVersion = {
              id: `${sceneId}-batch-${Date.now()}`,
              sceneId,
              timestamp: Date.now(),
              rewrittenText: result.rewrittenText,
              issuesAddressed: result.issuesAddressed || [],
              changesExplanation: result.changesExplanation || '',
              modelUsed: result.modelUsed || 'unknown',
              userEdited: false,
              appliedToManuscript: false
            };
            
            set(state => {
              const rewrites = new Map(state.sceneRewrites);
              // Batch also replaces existing rewrites (ONE rewrite rule)
              rewrites.set(sceneId, [rewriteVersion]);
              
              // Update diff cache
              const manuscriptLocal = useManuscriptStore.getState().manuscript;
              const scene = manuscriptLocal?.scenes.find(s => s.id === sceneId);
              if (scene) {
                const diffSegments = DiffEngine.generateDiff(scene.text, result.rewrittenText!,
                  { granularity: 'word', includeReasons: true }
                );
                const diffCache = new Map(state.diffCache);
                diffCache.set(sceneId, diffSegments);
                return { sceneRewrites: rewrites, diffCache };
              }
              
              return { sceneRewrites: rewrites };
            });
            
            // Update manuscript scene status
            useManuscriptStore.getState().updateScene(sceneId, {
              rewriteStatus: 'generated',
              currentRewrite: result.rewrittenText
            });
          }
        });
      };
      
      // Run batch rewrite
      const finalProgress = await orchestrator.rewriteMovedScenes(
        manuscript,
        {
          ...options,
          progressCallback,
          skipIfNoIssues: options.skipIfNoIssues ?? true
        }
      );
      
      // Only set final progress if not cancelled in the meantime
      if (!get().batchCancelled) {
        set({ batchProgress: finalProgress });
      }
      
    } catch (error) {
      console.error('[RewriteStore] Batch rewrite error:', error);
      set(state => ({
        batchProgress: state.batchProgress ? {
          ...state.batchProgress,
          phase: 'error',
          message: 'Batch rewrite failed'
        } : undefined
      }));
    } finally {
      set({ isBatchRewriting: false });
    }
  },
  
  cancelBatchRewrite: () => {
    const orchestrator = get().batchOrchestrator;
    orchestrator?.cancelBatch();
    
    set(state => ({
      isBatchRewriting: false,
      batchCancelled: true,
      batchProgress: state.batchProgress ? {
        ...state.batchProgress,
        phase: 'error',
        message: 'Batch rewrite cancelled'
      } : undefined
    }));
  },
  
  toggleHistory: (sceneId: string) => {
    set(state => {
      const showHistory = new Map(state.showHistory);
      showHistory.set(sceneId, !showHistory.get(sceneId));
      return { showHistory };
    });
  },
  
  clearAllRewrites: () => {
    set({
      sceneRewrites: new Map(),
      activeEdits: new Map(),
      diffCache: new Map(),
      showHistory: new Map(),
      batchProgress: undefined
    });
    
    // Reset all scene statuses
    const manuscript = useManuscriptStore.getState().manuscript;
    manuscript?.scenes.forEach(scene => {
      if (scene.currentRewrite || scene.rewriteStatus !== 'pending') {
        useManuscriptStore.getState().updateScene(scene.id, {
          rewriteStatus: 'pending',
          currentRewrite: undefined
        });
      }
    });
  },
  
  getRewriteHistory: (sceneId: string) => {
    // Store currently only keeps latest, but structure supports history
    return get().sceneRewrites.get(sceneId) || [];
  },
  
  // Getters
  getLatestRewrite: (sceneId: string) => {
    const history = get().sceneRewrites.get(sceneId);
    return history?.[history.length - 1];
  },
  
  getEditedText: (sceneId: string) => {
    return get().activeEdits.get(sceneId);
  },
  
  getDiff: (sceneId: string) => {
    return get().diffCache.get(sceneId);
  },
  
  hasRewrite: (sceneId: string) => {
    return get().sceneRewrites.has(sceneId);
  },
  
  isEditing: (sceneId: string) => {
    return get().activeEdits.has(sceneId);
  }
}));

export default useRewriteStore;