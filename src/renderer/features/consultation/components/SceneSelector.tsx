import React, { useMemo } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';

export interface SceneSelectorProps {
  selectedSceneIds: string[];
  onSelectionChange: (sceneIds: string[]) => void;
  disabled?: boolean;
  className?: string;
}

const SceneSelector: React.FC<SceneSelectorProps> = ({
  selectedSceneIds,
  onSelectionChange,
  disabled = false,
  className = ''
}) => {
  const manuscript = useManuscriptStore((s) => s.manuscript);

  const scenes = useMemo(() => {
    return manuscript?.scenes || [];
  }, [manuscript]);

  const handleSceneToggle = (sceneId: string) => {
    if (disabled) return;

    const newSelection = selectedSceneIds.includes(sceneId)
      ? selectedSceneIds.filter(id => id !== sceneId)
      : [...selectedSceneIds, sceneId];

    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onSelectionChange(scenes.map(s => s.id));
  };

  const handleSelectNone = () => {
    if (disabled) return;
    onSelectionChange([]);
  };

  const handleSelectMoved = () => {
    if (disabled) return;
    const movedScenes = scenes.filter(s => s.hasBeenMoved);
    onSelectionChange(movedScenes.map(s => s.id));
  };

  const handleSelectWithIssues = () => {
    if (disabled) return;
    const scenesWithIssues = scenes.filter(s =>
      (s.continuityAnalysis?.issues?.length ?? 0) > 0
    );
    onSelectionChange(scenesWithIssues.map(s => s.id));
  };

  if (!manuscript || scenes.length === 0) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <svg className="w-8 h-8 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm">No manuscript loaded</p>
      </div>
    );
  }

  const movedScenesCount = scenes.filter(s => s.hasBeenMoved).length;
  const scenesWithIssuesCount = scenes.filter(s => (s.continuityAnalysis?.issues?.length ?? 0) > 0).length;

  return (
    <div className={className}>
      {/* Selection Controls */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={handleSelectAll}
          disabled={disabled}
          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          All ({scenes.length})
        </button>
        <button
          onClick={handleSelectNone}
          disabled={disabled}
          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          None
        </button>
        {movedScenesCount > 0 && (
          <button
            onClick={handleSelectMoved}
            disabled={disabled}
            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Moved ({movedScenesCount})
          </button>
        )}
        {scenesWithIssuesCount > 0 && (
          <button
            onClick={handleSelectWithIssues}
            disabled={disabled}
            className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            With Issues ({scenesWithIssuesCount})
          </button>
        )}
      </div>

      {/* Scene List */}
      <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
        {scenes.map((scene) => {
          const isSelected = selectedSceneIds.includes(scene.id);
          const issueCount = scene.continuityAnalysis?.issues?.length ?? 0;

          return (
            <label
              key={scene.id}
              className={`
                flex items-center gap-3 p-3 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                ${isSelected ? 'bg-purple-50' : ''}
              `}
            >
              <input
                type="checkbox"
                value={scene.id}
                checked={isSelected}
                onChange={() => handleSceneToggle(scene.id)}
                disabled={disabled}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">
                    {scene.id}
                  </span>
                  <span className="text-xs text-gray-500">
                    Position {scene.position + 1}
                  </span>
                  {scene.hasBeenMoved && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
                      Moved
                    </span>
                  )}
                  {issueCount > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
                      {issueCount} issue{issueCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">
                  {scene.text.substring(0, 120)}
                  {scene.text.length > 120 ? '...' : ''}
                </p>
                {scene.characters && scene.characters.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {scene.characters.slice(0, 3).map((character) => (
                      <span
                        key={character}
                        className="inline-flex items-center px-1 py-0.5 rounded text-xs bg-gray-100 text-gray-700"
                      >
                        {character}
                      </span>
                    ))}
                    {scene.characters.length > 3 && (
                      <span className="inline-flex items-center px-1 py-0.5 rounded text-xs bg-gray-100 text-gray-500">
                        +{scene.characters.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {/* Selection Summary */}
      <div className="mt-2 text-xs text-gray-600">
        {selectedSceneIds.length === 0 ? (
          'No scenes selected'
        ) : (
          `${selectedSceneIds.length} of ${scenes.length} scene${scenes.length !== 1 ? 's' : ''} selected`
        )}
      </div>
    </div>
  );
};

export default SceneSelector;