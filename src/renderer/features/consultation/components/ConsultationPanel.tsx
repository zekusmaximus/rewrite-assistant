import React, { useEffect, useCallback } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import { useAIStatusStore } from '../../../stores/aiStatusStore';
import { useSettingsStore } from '../../settings/stores/useSettingsStore';
import { useConsultationStore } from '../stores/consultationStore';
import SceneSelector from './SceneSelector';
import ContextViewer from './ContextViewer';
import ConversationHistory from './ConversationHistory';
import QueryInput from './QueryInput';
import SessionStatus from './SessionStatus';

export interface ConsultationPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

const ConsultationPanel: React.FC<ConsultationPanelProps> = ({
  isOpen = true,
  onClose,
  className = ''
}) => {
  const manuscript = useManuscriptStore((s) => s.manuscript);
  const status = useAIStatusStore((s) => s.status);
  const checkStatus = useAIStatusStore((s) => s.checkStatus);
  const openSettings = useSettingsStore((s) => s.openSettings);

  const {
    isPanelOpen,
    selectedSceneIds,
    isSessionActive,
    isLoading,
    error,
    contextSummary,
    conversationHistory,
    currentQuery,
    contextOptions,
    closePanel,
    selectScenes,
    setContextOptions,
    startSession,
    endSession,
    sendQuery,
    updateCurrentQuery,
    clearError,
    clearConversation
  } = useConsultationStore();

  // Sync panel state with prop
  useEffect(() => {
    if (!isOpen && isPanelOpen) {
      closePanel();
    }
  }, [isOpen, isPanelOpen, closePanel]);

  // Ensure AI status is fresh when panel opens
  useEffect(() => {
    if (isOpen) {
      void checkStatus();
    }
  }, [isOpen, checkStatus]);

  const handleStartSession = useCallback(async () => {
    if (!manuscript || selectedSceneIds.length === 0) {
      return;
    }
    await startSession();
  }, [manuscript, selectedSceneIds, startSession]);

  const handleSendQuery = useCallback(async (question: string) => {
    await sendQuery(question);
  }, [sendQuery]);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      closePanel();
    }
  }, [onClose, closePanel]);


  if (!isOpen) {
    return null;
  }

  // Show AI setup prompt if no providers configured
  if (!status.available && status.needsConfiguration) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}>
        <div className="p-6 text-center">
          <div className="mb-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              AI Configuration Required
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Scene consultation requires AI providers to be configured. Set up your API keys to start asking questions about your scenes.
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={openSettings}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Configure AI
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Scene Consultation</h2>
          {contextSummary && (
            <span className="text-xs text-gray-500">
              {contextSummary.sceneCount} scene{contextSummary.sceneCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <SessionStatus />
          {onClose && (
            <button
              onClick={handleClose}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close consultation panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-800">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm">{error}</span>
            </div>
            <button
              onClick={clearError}
              className="text-red-600 hover:text-red-700 transition-colors"
              aria-label="Dismiss error"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="p-4 space-y-4">
        {!isSessionActive ? (
          // Session Setup
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">
                Start Consultation Session
              </h3>
              <SceneSelector
                selectedSceneIds={selectedSceneIds}
                onSelectionChange={selectScenes}
                disabled={isLoading}
              />
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2">
                Include Context
              </h4>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={contextOptions.includeContinuityAnalysis}
                    onChange={(e) => setContextOptions({ includeContinuityAnalysis: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm text-gray-700">Continuity issues</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={contextOptions.includeGlobalCoherence}
                    onChange={(e) => setContextOptions({ includeGlobalCoherence: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm text-gray-700">Global coherence analysis</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={contextOptions.includeRewriteHistory}
                    onChange={(e) => setContextOptions({ includeRewriteHistory: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm text-gray-700">Rewrite history</span>
                </label>
              </div>
            </div>

            <button
              onClick={handleStartSession}
              disabled={selectedSceneIds.length === 0 || isLoading}
              className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Starting Session...' : 'Start Consultation'}
            </button>
          </div>
        ) : (
          // Active Session
          <div className="space-y-4">
            {contextSummary && (
              <ContextViewer
                contextSummary={contextSummary}
                selectedSceneIds={selectedSceneIds}
              />
            )}

            <ConversationHistory
              history={conversationHistory}
              isLoading={isLoading}
            />

            <QueryInput
              value={currentQuery}
              onChange={updateCurrentQuery}
              onSend={handleSendQuery}
              disabled={isLoading}
              placeholder="Ask me about your scene arrangement..."
            />

            <div className="flex gap-2">
              <button
                onClick={clearConversation}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                disabled={isLoading || conversationHistory.length === 0}
              >
                Clear Chat
              </button>
              <button
                onClick={endSession}
                className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
                disabled={isLoading}
              >
                End Session
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConsultationPanel;