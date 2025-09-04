import React from 'react';
import { useManuscriptStore } from '../stores/manuscriptStore';
import { IPC_CHANNELS } from '../../shared/constants';
import type { Scene, ReaderKnowledge } from '../../shared/types';

// Helper: focused reader context builder (Phase 3.1)
const buildReaderContext = (previousScenes: Scene[]): ReaderKnowledge => {
  const context: ReaderKnowledge = {
    knownCharacters: new Set<string>(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };

  previousScenes.forEach((scene) => {
    scene.characters?.forEach((char) => context.knownCharacters.add(char));
    scene.timeMarkers?.forEach((marker) => {
      context.establishedTimeline.push({ label: marker });
    });
    scene.locationMarkers?.forEach((loc) => {
      context.establishedSettings.push({ name: loc });
    });
    // If your Scene type includes plot markers, add them here similarly
    if (Array.isArray((scene as any).plotMarkers)) {
      (scene as any).plotMarkers.forEach((p: string) => {
        context.revealedPlotPoints.push(p);
      });
    }
  });

  return context;
};

const SceneViewer: React.FC = () => {
  const { getSelectedScene, manuscript } = useManuscriptStore();
  const selectedScene = getSelectedScene();
  const analysis = selectedScene?.continuityAnalysis;
  const [isGeneratingRewrite, setIsGeneratingRewrite] = React.useState(false);

  const handleGenerateRewrite = async () => {
    if (!selectedScene || !(analysis as any)?.issues) return;

    setIsGeneratingRewrite(true);
    try {
      const currentOrder = manuscript?.currentOrder || [];
      const sceneIndex = currentOrder.indexOf(selectedScene.id);
      const previousSceneIds = currentOrder.slice(Math.max(0, sceneIndex - 3), sceneIndex);
      const previousScenes = previousSceneIds
        .map((id) => manuscript?.scenes.find((s) => s.id === id))
        .filter(Boolean) as Scene[];

      const readerContext = buildReaderContext(previousScenes);

      const result = await (window as any).electron?.ipcRenderer?.invoke(
        IPC_CHANNELS.GENERATE_REWRITE,
        {
          sceneId: selectedScene.id,
          scene: selectedScene,
          issues: (analysis as any).issues,
          previousScenes,
          readerContext,
          preserveElements: [], // Phase 3.1: placeholder; configurable in 3.2+
        }
      );

      if (result?.success && result?.rewrittenText) {
        // Phase 3.1: log to console; state/store integration to follow in Phase 3.2
        // eslint-disable-next-line no-console
        console.log('[SceneViewer] Rewrite generated:', {
          sceneId: selectedScene.id,
          explanation: result.changesExplanation,
          model: result.modelUsed,
        });
        // eslint-disable-next-line no-console
        console.log('Original:', selectedScene.text);
        // eslint-disable-next-line no-console
        console.log('Rewritten:', result.rewrittenText);
      } else {
        // eslint-disable-next-line no-console
        console.error('[SceneViewer] Rewrite generation failed:', result?.error || 'Unknown error');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SceneViewer] Error generating rewrite:', err);
    } finally {
      setIsGeneratingRewrite(false);
    }
  };

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
            {selectedScene?.hasBeenMoved && (analysis as any)?.issues?.length > 0 && (
              <button
                onClick={handleGenerateRewrite}
                disabled={isGeneratingRewrite || selectedScene.rewriteStatus === 'pending'}
                className={`
                  px-3 py-1 text-sm font-medium rounded-md
                  focus:outline-none focus:ring-2
                  ${isGeneratingRewrite || selectedScene.rewriteStatus === 'pending'
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'text-green-700 bg-green-100 hover:bg-green-200 focus:ring-green-500'
                  }
                `}
              >
                {isGeneratingRewrite || selectedScene.rewriteStatus === 'pending'
                  ? 'Generating...'
                  : 'Generate Rewrite'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SceneViewer;

