import React, { useState } from 'react';
import type { RewriteVersion, Scene, Manuscript } from '../../../../shared/types';
import ChangeExplanation from './ChangeExplanation';

interface RewriteHistoryProps {
  sceneRewrites: Map<string, RewriteVersion[]>;
  manuscript: Manuscript;
}

const RewriteHistory: React.FC<RewriteHistoryProps> = ({
  sceneRewrites,
  manuscript
}) => {
  const [expandedScene, setExpandedScene] = useState<string | null>(null);
  
  const scenesWithHistory = Array.from(sceneRewrites.entries())
    .map(([sceneId, versions]) => {
      const scene = manuscript.scenes.find(s => s.id === sceneId);
      return scene ? { scene, versions } : null;
    })
    .filter(Boolean) as Array<{ scene: Scene; versions: RewriteVersion[] }>;
  
  if (scenesWithHistory.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <div className="text-center text-gray-500">
          No rewrite history available yet
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {scenesWithHistory.map(({ scene, versions }) => (
        <div key={scene.id} className="bg-white rounded-lg border border-gray-200">
          {/* Scene Header */}
          <button
            onClick={() => setExpandedScene(
              expandedScene === scene.id ? null : scene.id
            )}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="text-left">
                <div className="font-medium text-gray-900">
                  Scene {scene.position + 1}
                </div>
                <div className="text-sm text-gray-600">
                  {versions.length} rewrite{versions.length !== 1 ? 's' : ''}
                </div>
              </div>
              {scene.rewriteStatus === 'approved' && (
                <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">
                  Applied
                </span>
              )}
            </div>
            <svg 
              className={`w-5 h-5 text-gray-400 transition-transform ${
                expandedScene === scene.id ? 'rotate-180' : ''
              }`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {/* Expanded History */}
          {expandedScene === scene.id && (
            <div className="border-t border-gray-200 divide-y divide-gray-100">
              {versions.map((version, index) => (
                <div key={version.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        Version {index + 1}
                      </span>
                      {version.userEdited && (
                        <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                          User Edited
                        </span>
                      )}
                      {version.appliedToManuscript && (
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">
                          Applied
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(version.timestamp).toLocaleString()}
                    </div>
                  </div>
                  
                  <ChangeExplanation 
                    explanation={version.changesExplanation}
                    issuesAddressed={version.issuesAddressed}
                    modelUsed={version.modelUsed}
                  />
                  
                  {/* Preview of rewrite */}
                  <div className="mt-3 p-3 bg-gray-50 rounded text-sm text-gray-700">
                    <div className="line-clamp-3">
                      {version.rewrittenText}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default RewriteHistory;