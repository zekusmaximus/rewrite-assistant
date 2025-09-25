import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConsultationStore } from '../stores/consultationStore';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import type { Manuscript, ConsultationResponse } from '../../../../shared/types';

// Mock the IPC renderer
const mockIpcInvoke = vi.fn();
vi.stubGlobal('window', {
  electron: {
    ipcRenderer: {
      invoke: mockIpcInvoke
    }
  }
});

// Mock manuscript store
vi.mock('../../../stores/manuscriptStore', () => ({
  useManuscriptStore: {
    getState: vi.fn()
  }
}));

const mockManuscript: Manuscript = {
  id: 'test-manuscript',
  title: 'Test Manuscript',
  scenes: [
    {
      id: 'scene1',
      text: 'First scene content',
      wordCount: 3,
      position: 0,
      originalPosition: 0,
      characters: ['Alice'],
      timeMarkers: [],
      locationMarkers: [],
      hasBeenMoved: true,
      rewriteStatus: 'pending'
    },
    {
      id: 'scene2',
      text: 'Second scene content',
      wordCount: 3,
      position: 1,
      originalPosition: 1,
      characters: ['Bob'],
      timeMarkers: [],
      locationMarkers: [],
      hasBeenMoved: false,
      rewriteStatus: 'pending'
    }
  ],
  originalOrder: ['scene1', 'scene2'],
  currentOrder: ['scene1', 'scene2']
};

describe('consultationStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useConsultationStore.getState().closePanel();
    useConsultationStore.setState({
      currentSessionId: null,
      isSessionActive: false,
      selectedSceneIds: [],
      conversationHistory: [],
      error: null,
      isLoading: false,
      contextOptions: {
        includeContinuityAnalysis: true,
        includeGlobalCoherence: true,
        includeRewriteHistory: false
      }
    });

    // Mock manuscript store to return test manuscript
    vi.mocked(useManuscriptStore.getState).mockReturnValue({
      manuscript: mockManuscript,
      selectedSceneId: null,
      isLoading: false,
      error: null,
      setManuscript: vi.fn(),
      selectScene: vi.fn(),
      reorderScenes: vi.fn(),
      updateScene: vi.fn(),
      setLoading: vi.fn(),
      setError: vi.fn(),
      clearManuscript: vi.fn(),
      undoReorder: vi.fn(),
      redoReorder: vi.fn(),
      getSelectedScene: vi.fn(),
      getSceneById: vi.fn(),
      canUndo: vi.fn(),
      canRedo: vi.fn()
    });

    mockIpcInvoke.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('panel management', () => {
    it('should open and close panel', () => {
      const store = useConsultationStore.getState();

      expect(store.isPanelOpen).toBe(false);

      store.openPanel();
      expect(useConsultationStore.getState().isPanelOpen).toBe(true);
      expect(useConsultationStore.getState().error).toBe(null);

      store.closePanel();
      expect(useConsultationStore.getState().isPanelOpen).toBe(false);
    });
  });

  describe('scene selection', () => {
    it('should select scenes', () => {
      const store = useConsultationStore.getState();

      store.selectScenes(['scene1', 'scene2']);
      expect(useConsultationStore.getState().selectedSceneIds).toEqual(['scene1', 'scene2']);
    });

    it('should update context options', () => {
      const store = useConsultationStore.getState();

      store.setContextOptions({ includeContinuityAnalysis: false });
      expect(useConsultationStore.getState().contextOptions.includeContinuityAnalysis).toBe(false);
      expect(useConsultationStore.getState().contextOptions.includeGlobalCoherence).toBe(true);

      store.setContextOptions({
        includeContinuityAnalysis: true,
        includeRewriteHistory: true
      });
      expect(useConsultationStore.getState().contextOptions.includeContinuityAnalysis).toBe(true);
      expect(useConsultationStore.getState().contextOptions.includeRewriteHistory).toBe(true);
    });
  });

  describe('session management', () => {
    it('should start session successfully', async () => {
      mockIpcInvoke.mockResolvedValueOnce({
        ok: true,
        sessionId: 'test-session-123',
        context: {
          sceneCount: 2,
          continuityIssueCount: 1,
          hasGlobalCoherence: true,
          readerKnowledgeSummary: {
            charactersCount: 2,
            timelineEventsCount: 0,
            plotPointsCount: 0,
            settingsCount: 0
          }
        }
      });

      const store = useConsultationStore.getState();
      store.selectScenes(['scene1', 'scene2']);

      await store.startSession();

      const state = useConsultationStore.getState();
      expect(state.currentSessionId).toBe('test-session-123');
      expect(state.isSessionActive).toBe(true);
      expect(state.sessionStartTime).toBeTruthy();
      expect(state.contextSummary).toEqual({
        sceneCount: 2,
        continuityIssueCount: 1,
        hasGlobalCoherence: true,
        readerKnowledgeSummary: {
          charactersCount: 2,
          timelineEventsCount: 0,
          plotPointsCount: 0,
          settingsCount: 0
        }
      });
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe(null);

      expect(mockIpcInvoke).toHaveBeenCalledWith(
        'scene-consultation:start',
        {
          sceneIds: ['scene1', 'scene2'],
          manuscript: mockManuscript,
          includeContinuityAnalysis: true,
          includeGlobalCoherence: true,
          includeRewriteHistory: false
        }
      );
    });

    it('should handle session start error', async () => {
      mockIpcInvoke.mockResolvedValueOnce({
        ok: false,
        error: { message: 'Failed to start session' }
      });

      const store = useConsultationStore.getState();
      store.selectScenes(['scene1']);

      await store.startSession();

      const state = useConsultationStore.getState();
      expect(state.currentSessionId).toBe(null);
      expect(state.isSessionActive).toBe(false);
      expect(state.error).toBe('Failed to start session');
      expect(state.isLoading).toBe(false);
    });

    it('should require scene selection to start session', async () => {
      const store = useConsultationStore.getState();
      // Don't select any scenes

      await store.startSession();

      const state = useConsultationStore.getState();
      expect(state.error).toBe('Please select at least one scene to start consultation');
      expect(mockIpcInvoke).not.toHaveBeenCalled();
    });

    it('should end session', async () => {
      mockIpcInvoke.mockResolvedValueOnce({ ok: true });

      const store = useConsultationStore.getState();
      useConsultationStore.setState({
        currentSessionId: 'test-session',
        isSessionActive: true,
        conversationHistory: [/* some history */]
      });

      await store.endSession();

      const state = useConsultationStore.getState();
      expect(state.currentSessionId).toBe(null);
      expect(state.isSessionActive).toBe(false);
      expect(state.conversationHistory).toEqual([]);
      expect(state.contextSummary).toBe(null);

      expect(mockIpcInvoke).toHaveBeenCalledWith(
        'scene-consultation:end',
        { sessionId: 'test-session' }
      );
    });
  });

  describe('query handling', () => {
    it('should send query successfully', async () => {
      const mockResponse: ConsultationResponse = {
        answer: 'This scene arrangement works well because...',
        confidence: 0.85,
        referencedIssues: [],
        referencedScenes: ['scene1'],
        timestamp: Date.now(),
        modelUsed: 'claude-sonnet-4',
        sessionId: 'test-session'
      };

      mockIpcInvoke.mockResolvedValueOnce(mockResponse);

      const store = useConsultationStore.getState();
      useConsultationStore.setState({
        currentSessionId: 'test-session',
        isSessionActive: true,
        selectedSceneIds: ['scene1'],
        contextOptions: {
          includeContinuityAnalysis: true,
          includeGlobalCoherence: false,
          includeRewriteHistory: false
        }
      });

      await store.sendQuery('How does this scene placement affect the story?');

      const state = useConsultationStore.getState();
      expect(state.conversationHistory).toHaveLength(1);
      expect(state.conversationHistory[0].response).toEqual(mockResponse);
      expect(state.conversationHistory[0].query.question).toBe('How does this scene placement affect the story?');
      expect(state.currentQuery).toBe('');
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe(null);

      expect(mockIpcInvoke).toHaveBeenCalledWith(
        'scene-consultation:query',
        {
          question: 'How does this scene placement affect the story?',
          selectedSceneIds: ['scene1'],
          includeContext: {
            continuityIssues: true,
            readerKnowledge: true,
            globalCoherence: false,
            rewriteHistory: false
          },
          sessionId: 'test-session',
          manuscript: mockManuscript
        }
      );
    });

    it('should handle query error', async () => {
      mockIpcInvoke.mockRejectedValueOnce(new Error('Network error'));

      const store = useConsultationStore.getState();
      useConsultationStore.setState({
        currentSessionId: 'test-session',
        isSessionActive: true,
        selectedSceneIds: ['scene1']
      });

      await store.sendQuery('Test question');

      const state = useConsultationStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
      expect(state.conversationHistory).toHaveLength(0);
    });

    it('should require active session to send query', async () => {
      const store = useConsultationStore.getState();
      // No active session

      await store.sendQuery('Test question');

      const state = useConsultationStore.getState();
      expect(state.error).toBe('No active consultation session');
      expect(mockIpcInvoke).not.toHaveBeenCalled();
    });

    it('should require non-empty question', async () => {
      const store = useConsultationStore.getState();
      useConsultationStore.setState({
        currentSessionId: 'test-session',
        isSessionActive: true
      });

      await store.sendQuery('   ');

      const state = useConsultationStore.getState();
      expect(state.error).toBe('Please enter a question');
      expect(mockIpcInvoke).not.toHaveBeenCalled();
    });
  });

  describe('utility actions', () => {
    it('should update current query', () => {
      const store = useConsultationStore.getState();

      store.updateCurrentQuery('My test question');
      expect(useConsultationStore.getState().currentQuery).toBe('My test question');
    });

    it('should clear error', () => {
      useConsultationStore.setState({ error: 'Some error' });

      const store = useConsultationStore.getState();
      store.clearError();

      expect(useConsultationStore.getState().error).toBe(null);
    });

    it('should clear conversation', () => {
      useConsultationStore.setState({
        conversationHistory: [/* some history */] as any
      });

      const store = useConsultationStore.getState();
      store.clearConversation();

      expect(useConsultationStore.getState().conversationHistory).toEqual([]);
    });
  });
});