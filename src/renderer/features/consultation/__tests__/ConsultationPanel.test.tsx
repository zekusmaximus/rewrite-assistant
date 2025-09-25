import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConsultationPanel from '../components/ConsultationPanel';
import { useConsultationStore } from '../stores/consultationStore';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import { useAIStatusStore } from '../../../stores/aiStatusStore';
import { useSettingsStore } from '../../settings/stores/useSettingsStore';

// Mock all the stores and their hooks
vi.mock('../stores/consultationStore');
vi.mock('../../../stores/manuscriptStore');
vi.mock('../../../stores/aiStatusStore');
vi.mock('../../settings/stores/useSettingsStore');

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

describe('ConsultationPanel', () => {
  const mockConsultationStore = {
    isPanelOpen: true,
    selectedSceneIds: [],
    isSessionActive: false,
    isLoading: false,
    error: null,
    contextSummary: null,
    conversationHistory: [],
    currentQuery: '',
    contextOptions: {
      includeContinuityAnalysis: true,
      includeGlobalCoherence: true,
      includeRewriteHistory: false
    },
    closePanel: vi.fn(),
    selectScenes: vi.fn(),
    setContextOptions: vi.fn(),
    startSession: vi.fn(),
    endSession: vi.fn(),
    sendQuery: vi.fn(),
    updateCurrentQuery: vi.fn(),
    clearError: vi.fn(),
    clearConversation: vi.fn()
  };

  const mockManuscriptStore = {
    manuscript: {
      id: 'test',
      title: 'Test',
      scenes: [
        { id: 'scene1', text: 'Scene 1' },
        { id: 'scene2', text: 'Scene 2' }
      ],
      originalOrder: ['scene1', 'scene2'],
      currentOrder: ['scene1', 'scene2']
    }
  };

  const mockAIStatusStore = {
    status: {
      available: true,
      workingProviders: ['claude'],
      needsConfiguration: false,
      lastChecked: Date.now(),
      isChecking: false
    },
    checkStatus: vi.fn(),
    requireAI: vi.fn()
  };

  const mockSettingsStore = {
    openSettings: vi.fn()
  };

  beforeEach(() => {
    vi.mocked(useConsultationStore).mockReturnValue(mockConsultationStore);
    vi.mocked(useManuscriptStore).mockReturnValue(mockManuscriptStore);
    vi.mocked(useAIStatusStore).mockReturnValue(mockAIStatusStore);
    vi.mocked(useSettingsStore).mockReturnValue(mockSettingsStore);
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
    vi.mocked(useAIStatusStore).mockReturnValue({
      ...mockAIStatusStore,
      status: {
        available: false,
        workingProviders: [],
        needsConfiguration: true,
        lastChecked: Date.now(),
        isChecking: false
      }
    });

    render(<ConsultationPanel isOpen={true} />);

    expect(screen.getByText('AI Configuration Required')).toBeInTheDocument();
    expect(screen.getByText('Configure AI')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should handle AI configuration button click', () => {
    vi.mocked(useAIStatusStore).mockReturnValue({
      ...mockAIStatusStore,
      status: {
        available: false,
        workingProviders: [],
        needsConfiguration: true,
        lastChecked: Date.now(),
        isChecking: false
      }
    });

    render(<ConsultationPanel isOpen={true} />);

    fireEvent.click(screen.getByText('Configure AI'));
    expect(mockSettingsStore.openSettings).toHaveBeenCalled();
  });

  it('should display error when present', () => {
    vi.mocked(useConsultationStore).mockReturnValue({
      ...mockConsultationStore,
      error: 'Test error message'
    });

    render(<ConsultationPanel isOpen={true} />);

    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('should clear error when dismiss button clicked', () => {
    vi.mocked(useConsultationStore).mockReturnValue({
      ...mockConsultationStore,
      error: 'Test error'
    });

    render(<ConsultationPanel isOpen={true} />);

    const dismissButton = screen.getByLabelText('Dismiss error');
    fireEvent.click(dismissButton);

    expect(mockConsultationStore.clearError).toHaveBeenCalled();
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
      render(<ConsultationPanel isOpen={true} />);

      const continuityCheckbox = screen.getByLabelText('Continuity issues');
      fireEvent.click(continuityCheckbox);

      expect(mockConsultationStore.setContextOptions).toHaveBeenCalledWith({
        includeContinuityAnalysis: false
      });
    });

    it('should handle scene selection', () => {
      render(<ConsultationPanel isOpen={true} />);

      const selectButton = screen.getByText('Select Scenes');
      fireEvent.click(selectButton);

      expect(mockConsultationStore.selectScenes).toHaveBeenCalledWith(['scene1', 'scene2']);
    });

    it('should start session when button clicked', async () => {
      vi.mocked(useConsultationStore).mockReturnValue({
        ...mockConsultationStore,
        selectedSceneIds: ['scene1']
      });

      render(<ConsultationPanel isOpen={true} />);

      const startButton = screen.getByText('Start Consultation');
      fireEvent.click(startButton);

      expect(mockConsultationStore.startSession).toHaveBeenCalled();
    });

    it('should disable start button when no scenes selected', () => {
      render(<ConsultationPanel isOpen={true} />);

      const startButton = screen.getByText('Start Consultation');
      expect(startButton).toBeDisabled();
    });

    it('should show loading state when starting session', () => {
      vi.mocked(useConsultationStore).mockReturnValue({
        ...mockConsultationStore,
        selectedSceneIds: ['scene1'],
        isLoading: true
      });

      render(<ConsultationPanel isOpen={true} />);

      expect(screen.getByText('Starting Session...')).toBeInTheDocument();
    });
  });

  describe('active session', () => {
    const activeSessionMock = {
      ...mockConsultationStore,
      isSessionActive: true,
      contextSummary: {
        sceneCount: 2,
        continuityIssueCount: 1,
        hasGlobalCoherence: true
      },
      conversationHistory: [],
      currentQuery: 'test query'
    };

    it('should show active session UI', () => {
      vi.mocked(useConsultationStore).mockReturnValue(activeSessionMock);

      render(<ConsultationPanel isOpen={true} />);

      expect(screen.getByTestId('context-viewer')).toBeInTheDocument();
      expect(screen.getByTestId('conversation-history')).toBeInTheDocument();
      expect(screen.getByTestId('query-input')).toBeInTheDocument();
      expect(screen.getByText('Clear Chat')).toBeInTheDocument();
      expect(screen.getByText('End Session')).toBeInTheDocument();
    });

    it('should handle query sending', () => {
      vi.mocked(useConsultationStore).mockReturnValue(activeSessionMock);

      render(<ConsultationPanel isOpen={true} />);

      const sendButton = screen.getByText('Send');
      fireEvent.click(sendButton);

      expect(mockConsultationStore.sendQuery).toHaveBeenCalledWith('test query');
    });

    it('should handle clear conversation', () => {
      vi.mocked(useConsultationStore).mockReturnValue(activeSessionMock);

      render(<ConsultationPanel isOpen={true} />);

      const clearButton = screen.getByText('Clear Chat');
      fireEvent.click(clearButton);

      expect(mockConsultationStore.clearConversation).toHaveBeenCalled();
    });

    it('should handle end session', () => {
      vi.mocked(useConsultationStore).mockReturnValue(activeSessionMock);

      render(<ConsultationPanel isOpen={true} />);

      const endButton = screen.getByText('End Session');
      fireEvent.click(endButton);

      expect(mockConsultationStore.endSession).toHaveBeenCalled();
    });

    it('should disable clear chat when no history', () => {
      vi.mocked(useConsultationStore).mockReturnValue({
        ...activeSessionMock,
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
    const { rerender } = render(<ConsultationPanel isOpen={false} />);
    expect(mockAIStatusStore.checkStatus).not.toHaveBeenCalled();

    rerender(<ConsultationPanel isOpen={true} />);
    expect(mockAIStatusStore.checkStatus).toHaveBeenCalled();
  });
});