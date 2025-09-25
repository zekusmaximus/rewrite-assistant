// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useConsultationStore } from '../stores/consultationStore';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import { useAIStatusStore } from '../../../stores/aiStatusStore';
import ConsultationPanel from '../components/ConsultationPanel';

// Mock only the settings store since it's not being imported above
vi.mock('../../settings/stores/useSettingsStore', () => {
  const openSettingsSpy = vi.fn();
  (globalThis as any).__openSettingsSpy = openSettingsSpy;

  const useSettingsStore = ((selector?: (s: { openSettings: () => void }) => unknown) => {
    const state = { openSettings: openSettingsSpy };
    return typeof selector === 'function' ? selector(state) : state;
  }) as any;

  return {
    __esModule: true,
    useSettingsStore,
  };
});

const openSettingsSpy = (globalThis as any).__openSettingsSpy;

// Mock the child components to focus on the panel logic
vi.mock('../components/SceneSelector', () => ({
  default: ({ selectedSceneIds, onSelectionChange, disabled }: any) => (
    <div data-testid="scene-selector">
      <div>Selected: {selectedSceneIds.join(', ')}</div>
      <button
        onClick={() => onSelectionChange(['scene1', 'scene2'])}
        disabled={disabled}
      >
        Select Scenes
      </button>
    </div>
  )
}));

vi.mock('../components/ContextViewer', () => ({
  default: ({ contextSummary }: any) => (
    <div data-testid="context-viewer">
      Context: {contextSummary.sceneCount} scenes
    </div>
  )
}));

vi.mock('../components/ConversationHistory', () => ({
  default: ({ history, isLoading }: any) => (
    <div data-testid="conversation-history">
      <div>History: {history.length} exchanges</div>
      {isLoading && <div>Loading...</div>}
    </div>
  )
}));

vi.mock('../components/QueryInput', () => ({
  default: ({ value, onChange, onSend, disabled }: any) => (
    <div data-testid="query-input">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Enter question"
      />
      <button onClick={() => onSend(value)} disabled={disabled}>
        Send
      </button>
    </div>
  )
}));

vi.mock('../components/SessionStatus', () => ({
  default: () => <div data-testid="session-status">Session Status</div>
}));

// Helper functions to setup store state
function seedManuscriptStore() {
  useManuscriptStore.setState({
    manuscript: {
      id: 'test',
      title: 'Test',
      scenes: [
        {
          id: 'scene1',
          text: 'Scene 1',
          wordCount: 2,
          position: 0,
          originalPosition: 0,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending' as const
        },
        {
          id: 'scene2',
          text: 'Scene 2',
          wordCount: 2,
          position: 1,
          originalPosition: 1,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending' as const
        }
      ],
      originalOrder: ['scene1', 'scene2'],
      currentOrder: ['scene1', 'scene2']
    },
    selectedSceneId: null,
    isLoading: false,
    error: null
  });
}

function seedAIStatusStore(partial: Partial<ReturnType<typeof useAIStatusStore.getState>['status']> = {}) {
  const base = {
    available: true,
    workingProviders: ['anthropic'] as Array<'anthropic' | 'openai' | 'google'>,
    needsConfiguration: false,
    lastChecked: Date.now(),
    isChecking: false
  };
  useAIStatusStore.setState({
    status: { ...base, ...partial },
    checkStatus: vi.fn(),
    requireAI: vi.fn()
  });
}

function seedConsultationStore() {
  useConsultationStore.setState({
    currentSessionId: null,
    isSessionActive: false,
    sessionStartTime: null,
    selectedSceneIds: [],
    contextOptions: {
      includeContinuityAnalysis: true,
      includeGlobalCoherence: true,
      includeRewriteHistory: false
    },
    contextSummary: null,
    conversationHistory: [],
    currentQuery: '',
    isLoading: false,
    error: null,
    isPanelOpen: true,
    closePanel: vi.fn(),
    selectScenes: vi.fn(),
    setContextOptions: vi.fn(),
    startSession: vi.fn(),
    endSession: vi.fn(),
    sendQuery: vi.fn(),
    updateCurrentQuery: vi.fn(),
    clearError: vi.fn(),
    clearConversation: vi.fn()
  });
}

describe('ConsultationPanel', () => {
  beforeEach(() => {
    seedManuscriptStore();
    seedAIStatusStore();
    seedConsultationStore();
    openSettingsSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render panel when open', () => {
    render(<ConsultationPanel isOpen={true} />);

    expect(screen.getByText('Scene Consultation')).toBeInTheDocument();
    expect(screen.getByTestId('session-status')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(<ConsultationPanel isOpen={false} />);

    expect(screen.queryByText('Scene Consultation')).not.toBeInTheDocument();
  });

  it('should show AI configuration required when unconfigured', () => {
    seedAIStatusStore({
      available: false,
      workingProviders: [],
      needsConfiguration: true,
      lastChecked: Date.now(),
      isChecking: false
    });

    render(<ConsultationPanel isOpen={true} />);

    expect(screen.getByText('AI Configuration Required')).toBeInTheDocument();
    expect(screen.getByText('Configure AI')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should handle AI configuration button click', () => {
    seedAIStatusStore({
      available: false,
      workingProviders: [],
      needsConfiguration: true,
      lastChecked: Date.now(),
      isChecking: false
    });

    render(<ConsultationPanel isOpen={true} />);

    fireEvent.click(screen.getByText('Configure AI'));
    expect(openSettingsSpy).toHaveBeenCalled();
  });

  it('should display error when present', () => {
    useConsultationStore.setState({ error: 'Test error message' });

    render(<ConsultationPanel isOpen={true} />);

    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('should clear error when dismiss button clicked', () => {
    const clearErrorSpy = vi.fn();
    useConsultationStore.setState({
      error: 'Test error',
      clearError: clearErrorSpy
    });

    render(<ConsultationPanel isOpen={true} />);

    const dismissButton = screen.getByLabelText('Dismiss error');
    fireEvent.click(dismissButton);

    expect(clearErrorSpy).toHaveBeenCalled();
  });

  describe('session setup', () => {
    it('should show session setup when no active session', () => {
      render(<ConsultationPanel isOpen={true} />);

      expect(screen.getByText('Start Consultation Session')).toBeInTheDocument();
      expect(screen.getByTestId('scene-selector')).toBeInTheDocument();
      expect(screen.getByText('Include Context')).toBeInTheDocument();
      expect(screen.getByText('Start Consultation')).toBeInTheDocument();
    });

    it('should handle context option changes', () => {
      const setContextOptionsSpy = vi.fn();
      useConsultationStore.setState({ setContextOptions: setContextOptionsSpy });

      render(<ConsultationPanel isOpen={true} />);

      const continuityCheckbox = screen.getByLabelText('Continuity issues');
      fireEvent.click(continuityCheckbox);

      expect(setContextOptionsSpy).toHaveBeenCalledWith({
        includeContinuityAnalysis: false
      });
    });

    it('should handle scene selection', () => {
      const selectScenesSpy = vi.fn();
      useConsultationStore.setState({ selectScenes: selectScenesSpy });

      render(<ConsultationPanel isOpen={true} />);

      const selectButton = screen.getByText('Select Scenes');
      fireEvent.click(selectButton);

      expect(selectScenesSpy).toHaveBeenCalledWith(['scene1', 'scene2']);
    });

    it('should start session when button clicked', async () => {
      const startSessionSpy = vi.fn();
      useConsultationStore.setState({
        selectedSceneIds: ['scene1'],
        startSession: startSessionSpy
      });

      render(<ConsultationPanel isOpen={true} />);

      const startButton = screen.getByText('Start Consultation');
      fireEvent.click(startButton);

      expect(startSessionSpy).toHaveBeenCalled();
    });

    it('should disable start button when no scenes selected', () => {
      render(<ConsultationPanel isOpen={true} />);

      const startButton = screen.getByText('Start Consultation');
      expect(startButton).toBeDisabled();
    });

    it('should show loading state when starting session', () => {
      useConsultationStore.setState({
        selectedSceneIds: ['scene1'],
        isLoading: true
      });

      render(<ConsultationPanel isOpen={true} />);

      expect(screen.getByText('Starting Session...')).toBeInTheDocument();
    });
  });

  describe('active session', () => {
    function seedActiveSession() {
      useConsultationStore.setState({
        isSessionActive: true,
        contextSummary: {
          sceneCount: 2,
          continuityIssueCount: 1,
          hasGlobalCoherence: true
        },
        conversationHistory: [],
        currentQuery: 'test query'
      });
    }

    it('should show active session UI', () => {
      seedActiveSession();

      render(<ConsultationPanel isOpen={true} />);

      expect(screen.getByTestId('context-viewer')).toBeInTheDocument();
      expect(screen.getByTestId('conversation-history')).toBeInTheDocument();
      expect(screen.getByTestId('query-input')).toBeInTheDocument();
      expect(screen.getByText('Clear Chat')).toBeInTheDocument();
      expect(screen.getByText('End Session')).toBeInTheDocument();
    });

    it('should handle query sending', () => {
      const sendQuerySpy = vi.fn();
      seedActiveSession();
      useConsultationStore.setState({ sendQuery: sendQuerySpy });

      render(<ConsultationPanel isOpen={true} />);

      const sendButton = screen.getByText('Send');
      fireEvent.click(sendButton);

      expect(sendQuerySpy).toHaveBeenCalledWith('test query');
    });

    it('should handle clear conversation', () => {
      const clearConversationSpy = vi.fn();
      seedActiveSession();
      useConsultationStore.setState({
        clearConversation: clearConversationSpy,
        conversationHistory: [
          {
            query: {
              question: 'Test question',
              selectedSceneIds: ['scene1'],
              includeContext: {
                continuityIssues: true,
                readerKnowledge: true,
                globalCoherence: true,
                rewriteHistory: false
              },
              sessionId: 'session1'
            },
            response: {
              answer: 'Test answer',
              confidence: 0.9,
              referencedIssues: [],
              referencedScenes: ['scene1'],
              timestamp: Date.now(),
              modelUsed: 'test-model',
              sessionId: 'session1'
            },
            timestamp: Date.now()
          }
        ]
      });

      render(<ConsultationPanel isOpen={true} />);

      const clearButton = screen.getByText('Clear Chat');
      fireEvent.click(clearButton);

      expect(clearConversationSpy).toHaveBeenCalled();
    });

    it('should handle end session', () => {
      const endSessionSpy = vi.fn();
      seedActiveSession();
      useConsultationStore.setState({ endSession: endSessionSpy });

      render(<ConsultationPanel isOpen={true} />);

      const endButton = screen.getByText('End Session');
      fireEvent.click(endButton);

      expect(endSessionSpy).toHaveBeenCalled();
    });

    it('should disable clear chat when no history', () => {
      seedActiveSession();
      useConsultationStore.setState({
        conversationHistory: []
      });

      render(<ConsultationPanel isOpen={true} />);

      const clearButton = screen.getByText('Clear Chat');
      expect(clearButton).toBeDisabled();
    });
  });

  it('should handle close button click', () => {
    const onClose = vi.fn();
    render(<ConsultationPanel isOpen={true} onClose={onClose} />);

    const closeButton = screen.getByLabelText('Close consultation panel');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('should call checkStatus when panel opens', () => {
    const checkStatusSpy = vi.fn();
    useAIStatusStore.setState({ checkStatus: checkStatusSpy });

    const { rerender } = render(<ConsultationPanel isOpen={false} />);
    expect(checkStatusSpy).not.toHaveBeenCalled();

    rerender(<ConsultationPanel isOpen={true} />);
    expect(checkStatusSpy).toHaveBeenCalled();
  });
});