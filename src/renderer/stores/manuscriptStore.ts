import { create } from 'zustand';
import { Manuscript, Scene } from '../../shared/types';
import { useHistoryStore } from './historyStore';

interface ManuscriptState {
  manuscript: Manuscript | null;
  selectedSceneId: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setManuscript: (manuscript: Manuscript) => void;
  selectScene: (sceneId: string) => void;
  reorderScenes: (newOrder: string[]) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearManuscript: () => void;
  undoReorder: () => void;
  redoReorder: () => void;
  
  // Getters
  getSelectedScene: () => Scene | null;
  getSceneById: (id: string) => Scene | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useManuscriptStore = create<ManuscriptState>((set, get) => ({
  manuscript: null,
  selectedSceneId: null,
  isLoading: false,
  error: null,
  
  setManuscript: (manuscript: Manuscript) => {
    // Initialize history with the original order
    useHistoryStore.getState().clearHistory();
    useHistoryStore.getState().pushState(manuscript.currentOrder);
    
    set({ 
      manuscript, 
      selectedSceneId: manuscript.scenes.length > 0 ? manuscript.scenes[0].id : null,
      error: null 
    });
  },
  
  selectScene: (sceneId: string) => set({ selectedSceneId: sceneId }),
  
  reorderScenes: (newOrder: string[]) => set((state) => {
    if (!state.manuscript) return state;
    
    // Save current order to history before changing
    useHistoryStore.getState().pushState(newOrder);
    
    // Update the current order and mark moved scenes
    const updatedScenes = state.manuscript.scenes.map(scene => {
      const newPosition = newOrder.indexOf(scene.id);
      const hasBeenMoved = newPosition !== scene.originalPosition;
      
      return {
        ...scene,
        position: newPosition,
        hasBeenMoved
      };
    });
    
    return {
      manuscript: {
        ...state.manuscript,
        scenes: updatedScenes,
        currentOrder: newOrder
      }
    };
  }),
  
  updateScene: (sceneId: string, updates: Partial<Scene>) => set((state) => {
    if (!state.manuscript) return state;
    
    const updatedScenes = state.manuscript.scenes.map(scene =>
      scene.id === sceneId ? { ...scene, ...updates } : scene
    );
    
    return {
      manuscript: {
        ...state.manuscript,
        scenes: updatedScenes
      }
    };
  }),
  
  setLoading: (loading: boolean) => set({ isLoading: loading }),
  
  setError: (error: string | null) => set({ error }),
  
  clearManuscript: () => {
    useHistoryStore.getState().clearHistory();
    set({ 
      manuscript: null, 
      selectedSceneId: null, 
      error: null 
    });
  },
  
  undoReorder: () => {
    const previousOrder = useHistoryStore.getState().undo();
    if (previousOrder && get().manuscript) {
      // Apply the previous order without adding to history
      const state = get();
      if (!state.manuscript) return;
      
      const updatedScenes = state.manuscript.scenes.map(scene => {
        const newPosition = previousOrder.indexOf(scene.id);
        const hasBeenMoved = newPosition !== scene.originalPosition;
        
        return {
          ...scene,
          position: newPosition,
          hasBeenMoved
        };
      });
      
      set({
        manuscript: {
          ...state.manuscript,
          scenes: updatedScenes,
          currentOrder: previousOrder
        }
      });
    }
  },
  
  redoReorder: () => {
    const nextOrder = useHistoryStore.getState().redo();
    if (nextOrder && get().manuscript) {
      // Apply the next order without adding to history
      const state = get();
      if (!state.manuscript) return;
      
      const updatedScenes = state.manuscript.scenes.map(scene => {
        const newPosition = nextOrder.indexOf(scene.id);
        const hasBeenMoved = newPosition !== scene.originalPosition;
        
        return {
          ...scene,
          position: newPosition,
          hasBeenMoved
        };
      });
      
      set({
        manuscript: {
          ...state.manuscript,
          scenes: updatedScenes,
          currentOrder: nextOrder
        }
      });
    }
  },
  
  // Getters
  getSelectedScene: () => {
    const state = get();
    if (!state.manuscript || !state.selectedSceneId) return null;
    return state.manuscript.scenes.find(scene => scene.id === state.selectedSceneId) || null;
  },
  
  getSceneById: (id: string) => {
    const state = get();
    if (!state.manuscript) return null;
    return state.manuscript.scenes.find(scene => scene.id === id) || null;
  },
  
  canUndo: () => useHistoryStore.getState().canUndo(),
  canRedo: () => useHistoryStore.getState().canRedo()
}));

