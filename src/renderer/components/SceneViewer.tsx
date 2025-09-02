import React from 'react';
import { useManuscriptStore } from '../stores/manuscriptStore';

const SceneViewer: React.FC = () => {
  const { getSelectedScene } = useManuscriptStore();
  const selectedScene = getSelectedScene();

  if (!selectedScene) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p>Select a scene to view its content</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Scene Header */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Scene {selectedScene.position + 1}
            </h3>
            <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
              <span>{selectedScene.wordCount} words</span>
              {selectedScene.hasBeenMoved && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Moved from position {selectedScene.originalPosition + 1}
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                selectedScene.rewriteStatus === 'pending' ? 'bg-gray-100 text-gray-800' :
                selectedScene.rewriteStatus === 'generated' ? 'bg-blue-100 text-blue-800' :
                selectedScene.rewriteStatus === 'approved' ? 'bg-green-100 text-green-800' :
                'bg-red-100 text-red-800'
              }`}>
                {selectedScene.rewriteStatus}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scene Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="prose max-w-none">
          <div className="whitespace-pre-wrap text-gray-900 leading-relaxed">
            {selectedScene.currentRewrite || selectedScene.text}
          </div>
        </div>
      </div>

      {/* Scene Actions */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-600">
            {selectedScene.hasBeenMoved ? (
              <span>This scene has been moved and may need rewriting</span>
            ) : (
              <span>Scene is in its original position</span>
            )}
          </div>
          <div className="flex gap-2">
            {selectedScene.hasBeenMoved && (
              <button className="px-3 py-1 text-sm font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
                Analyze Issues
              </button>
            )}
            <button className="px-3 py-1 text-sm font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-green-500">
              Generate Rewrite
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SceneViewer;

