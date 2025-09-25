import { create } from 'zustand';
import type {
  ConsultationQuery,
  ConsultationResponse
} from '../../../../shared/types';
import { IPC_CHANNELS } from '../../../../shared/constants';
import { useManuscriptStore } from '../../../stores/manuscriptStore';

export interface ConversationExchange {
  query: ConsultationQuery;
  response: ConsultationResponse;
  timestamp: number;
}

interface ConsultationState {
  // Session management
  currentSessionId: string | null;
  isSessionActive: boolean;
  sessionStartTime: number | null;

  // UI state
  isPanelOpen: boolean;
  selectedSceneIds: string[];
  isLoading: boolean;
  error: string | null;

  // Context configuration
  contextOptions: {
    includeContinuityAnalysis: boolean;
    includeGlobalCoherence: boolean;
    includeRewriteHistory: boolean;
  };

  // Consultation data
  conversationHistory: ConversationExchange[];
  currentQuery: string;
  contextSummary: {
    sceneCount: number;
    continuityIssueCount: number;
    hasGlobalCoherence: boolean;
    readerKnowledgeSummary?: {
      charactersCount: number;
      timelineEventsCount: number;
      plotPointsCount: number;
      settingsCount: number;
    };
  } | null;

  // Actions
  openPanel: () => void;
  closePanel: () => void;
  selectScenes: (sceneIds: string[]) => void;
  setContextOptions: (options: Partial<ConsultationState['contextOptions']>) => void;
  startSession: () => Promise<void>;
  endSession: () => Promise<void>;
  sendQuery: (question: string) => Promise<void>;
  updateCurrentQuery: (query: string) => void;
  clearError: () => void;
  clearConversation: () => void;
}

export const useConsultationStore = create<ConsultationState>((set, get) => ({
  // Initial state
  currentSessionId: null,
  isSessionActive: false,
  sessionStartTime: null,

  isPanelOpen: false,
  selectedSceneIds: [],
  isLoading: false,
  error: null,

  contextOptions: {
    includeContinuityAnalysis: true,
    includeGlobalCoherence: true,
    includeRewriteHistory: false,
  },

  conversationHistory: [],
  currentQuery: '',
  contextSummary: null,

  // Actions
  openPanel: () => set({ isPanelOpen: true, error: null }),

  closePanel: () => {
    const state = get();
    if (state.isSessionActive) {
      // Auto-end session when closing panel
      void state.endSession();
    }
    set({ isPanelOpen: false });
  },

  selectScenes: (sceneIds: string[]) => set({ selectedSceneIds: sceneIds }),

  setContextOptions: (options) => set((state) => ({
    contextOptions: { ...state.contextOptions, ...options }
  })),

  startSession: async () => {
    const state = get();
    const manuscript = useManuscriptStore.getState().manuscript;

    if (!manuscript || state.selectedSceneIds.length === 0) {
      set({ error: 'Please select at least one scene to start consultation' });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const response = await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SCENE_CONSULTATION_START,
        {
          sceneIds: state.selectedSceneIds,
          manuscript,
          includeContinuityAnalysis: state.contextOptions.includeContinuityAnalysis,
          includeGlobalCoherence: state.contextOptions.includeGlobalCoherence,
          includeRewriteHistory: state.contextOptions.includeRewriteHistory,
        }
      );

      if (response.ok) {
        set({
          currentSessionId: response.sessionId,
          isSessionActive: true,
          sessionStartTime: Date.now(),
          contextSummary: response.context,
          isLoading: false,
        });
      } else {
        set({
          error: response.error?.message || 'Failed to start consultation session',
          isLoading: false
        });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error starting session',
        isLoading: false
      });
    }
  },

  endSession: async () => {
    const state = get();
    if (!state.currentSessionId) return;

    try {
      await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SCENE_CONSULTATION_END,
        { sessionId: state.currentSessionId }
      );
    } catch (err) {
      console.warn('Error ending consultation session:', err);
    }

    set({
      currentSessionId: null,
      isSessionActive: false,
      sessionStartTime: null,
      conversationHistory: [],
      contextSummary: null,
    });
  },

  sendQuery: async (question: string) => {
    const state = get();
    const manuscript = useManuscriptStore.getState().manuscript;

    if (!state.currentSessionId || !manuscript) {
      set({ error: 'No active consultation session' });
      return;
    }

    if (!question.trim()) {
      set({ error: 'Please enter a question' });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const queryPayload: ConsultationQuery = {
        question: question.trim(),
        selectedSceneIds: state.selectedSceneIds,
        includeContext: {
          continuityIssues: state.contextOptions.includeContinuityAnalysis,
          readerKnowledge: true, // Always include reader knowledge
          globalCoherence: state.contextOptions.includeGlobalCoherence,
          rewriteHistory: state.contextOptions.includeRewriteHistory,
        },
        sessionId: state.currentSessionId,
      };

      const response: ConsultationResponse = await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SCENE_CONSULTATION_QUERY,
        {
          ...queryPayload,
          manuscript, // Include current manuscript state
        }
      );

      if (response.answer) {
        const exchange: ConversationExchange = {
          query: queryPayload,
          response,
          timestamp: Date.now(),
        };

        set((state) => ({
          conversationHistory: [...state.conversationHistory, exchange],
          currentQuery: '',
          isLoading: false,
        }));
      } else {
        set({
          error: 'Failed to get response from AI',
          isLoading: false
        });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error sending query',
        isLoading: false
      });
    }
  },

  updateCurrentQuery: (query: string) => set({ currentQuery: query }),

  clearError: () => set({ error: null }),

  clearConversation: () => set({ conversationHistory: [] }),
}));

export default useConsultationStore;