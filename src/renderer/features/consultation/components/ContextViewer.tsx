import React, { useState } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';

export interface ContextViewerProps {
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
  };
  selectedSceneIds: string[];
  className?: string;
}

const ContextViewer: React.FC<ContextViewerProps> = ({
  contextSummary,
  selectedSceneIds,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const manuscript = useManuscriptStore((s) => s.manuscript);

  const selectedScenes = manuscript?.scenes.filter(s => selectedSceneIds.includes(s.id)) || [];

  return (
    <div className={`border border-gray-200 rounded-lg ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-100 flex items-center justify-center">
            <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-gray-900">
            Context Available
          </span>
          <span className="text-xs text-gray-500">
            {contextSummary.sceneCount} scene{contextSummary.sceneCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {contextSummary.continuityIssueCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
                {contextSummary.continuityIssueCount} issue{contextSummary.continuityIssueCount !== 1 ? 's' : ''}
              </span>
            )}
            {contextSummary.hasGlobalCoherence && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
                Global analysis
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-3 space-y-3">
          {/* Selected Scenes */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              Selected Scenes
            </h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {selectedScenes.map((scene) => (
                <div
                  key={scene.id}
                  className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm"
                >
                  <span className="font-medium text-gray-900">{scene.id}</span>
                  <span className="text-gray-500">Position {scene.position + 1}</span>
                  {scene.hasBeenMoved && (
                    <span className="inline-flex items-center px-1 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
                      Moved
                    </span>
                  )}
                  {(scene.continuityAnalysis?.issues?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center px-1 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
                      {scene.continuityAnalysis!.issues.length} issue{scene.continuityAnalysis!.issues.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Reader Knowledge Summary */}
          {contextSummary.readerKnowledgeSummary && (
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2">
                Reader Knowledge
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Characters:</span>
                  <span className="font-medium">
                    {contextSummary.readerKnowledgeSummary.charactersCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Timeline events:</span>
                  <span className="font-medium">
                    {contextSummary.readerKnowledgeSummary.timelineEventsCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Plot points:</span>
                  <span className="font-medium">
                    {contextSummary.readerKnowledgeSummary.plotPointsCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Settings:</span>
                  <span className="font-medium">
                    {contextSummary.readerKnowledgeSummary.settingsCount}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Analysis Summary */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              Available Analysis
            </h4>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${contextSummary.continuityIssueCount > 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-gray-700">
                  Continuity Issues
                  {contextSummary.continuityIssueCount > 0 && (
                    <span className="text-amber-600 font-medium">
                      {' '}({contextSummary.continuityIssueCount} found)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${contextSummary.hasGlobalCoherence ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-gray-700">
                  Global Coherence Analysis
                  {contextSummary.hasGlobalCoherence && (
                    <span className="text-blue-600 font-medium"> (Available)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-700">
                  Reader Knowledge Context
                  <span className="text-green-600 font-medium"> (Active)</span>
                </span>
              </div>
            </div>
          </div>

          {/* Help Text */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              The AI has access to this information when answering your questions about the selected scenes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContextViewer;