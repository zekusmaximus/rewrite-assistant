import React from 'react';
import type { BatchRewriteProgress } from '../../../../services/rewrite/RewriteOrchestrator';

interface RewriteProgressProps {
  progress?: BatchRewriteProgress;
  isRunning: boolean;
  onCancel: () => void;
  onStart: () => void;
}

const RewriteProgress: React.FC<RewriteProgressProps> = ({
  progress,
  isRunning,
  onCancel,
  onStart
}) => {
  const progressPercent = progress 
    ? (progress.completedScenes / Math.max(progress.totalScenes, 1)) * 100
    : 0;
  
  const getPhaseColor = (phase?: string) => {
    switch(phase) {
      case 'complete': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'rewriting': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };
  
  if (!isRunning && !progress) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Batch Rewrite Process
          </h3>
          <p className="text-gray-600 mb-6">
            Generate rewrites for all moved scenes with identified issues
          </p>
          <button
            onClick={onStart}
            className="px-6 py-3 text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Start Batch Rewrite
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {isRunning ? 'Processing Rewrites' : 'Batch Complete'}
          </h3>
          <p className={`text-sm mt-1 ${getPhaseColor(progress?.phase)}`}>
            {progress?.message}
          </p>
        </div>
        {isRunning && (
          <button
            onClick={onCancel}
            className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
          >
            Cancel
          </button>
        )}
      </div>
      
      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Progress</span>
          <span>
            {progress?.completedScenes || 0} / {progress?.totalScenes || 0} scenes
          </span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ${
              progress?.phase === 'error' ? 'bg-red-500' : 
              progress?.phase === 'complete' ? 'bg-green-500' : 
              'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      
      {/* Current Scene */}
      {isRunning && progress?.currentSceneTitle && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg">
          <div className="text-sm text-blue-900">
            Currently rewriting: <strong>{progress.currentSceneTitle}</strong>
          </div>
        </div>
      )}
      
      {/* Results Summary */}
      {progress && (progress.phase === 'complete' || progress.phase === 'error') && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {progress.results.size}
              </div>
              <div className="text-sm text-green-900">Successful</div>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {progress.errors.size}
              </div>
              <div className="text-sm text-red-900">Failed</div>
            </div>
          </div>
          
          {/* Error Details */}
          {progress.errors.size > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                Failed Scenes:
              </h4>
              <div className="space-y-1">
                {Array.from(progress.errors.entries()).map(([sceneId, error]) => (
                  <div key={sceneId} className="text-xs text-red-600 bg-red-50 p-2 rounded">
                    Scene {sceneId}: {error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RewriteProgress;