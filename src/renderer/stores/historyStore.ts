import { create } from 'zustand';

interface HistoryState {
  past: string[][];
  present: string[];
  future: string[][];
  
  // Actions
  pushState: (newState: string[]) => void;
  undo: () => string[] | null;
  redo: () => string[] | null;
  clearHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  present: [],
  future: [],
  
  pushState: (newState: string[]) => set((state) => {
    // Don't add if the state is the same as current
    if (JSON.stringify(state.present) === JSON.stringify(newState)) {
      return state;
    }
    
    return {
      past: [...state.past, state.present],
      present: newState,
      future: [] // Clear future when new state is pushed
    };
  }),
  
  undo: () => {
    const state = get();
    if (state.past.length === 0) return null;
    
    const previous = state.past[state.past.length - 1];
    const newPast = state.past.slice(0, -1);
    
    set({
      past: newPast,
      present: previous,
      future: [state.present, ...state.future]
    });
    
    return previous;
  },
  
  redo: () => {
    const state = get();
    if (state.future.length === 0) return null;
    
    const next = state.future[0];
    const newFuture = state.future.slice(1);
    
    set({
      past: [...state.past, state.present],
      present: next,
      future: newFuture
    });
    
    return next;
  },
  
  clearHistory: () => set({
    past: [],
    present: [],
    future: []
  }),
  
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0
}));

