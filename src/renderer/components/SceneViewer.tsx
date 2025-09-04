import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useManuscriptStore } from '../stores/manuscriptStore';
import useIssueHighlighting from '../features/analyze/hooks/useIssueHighlighting';
import IssueHighlighter from '../features/analyze/components/IssueHighlighter';
import { IPC_CHANNELS } from '../../shared/constants';
import type { Scene, ReaderKnowledge, ContinuityIssue } from '../../shared/types';

export interface SceneViewerHandle {
  scrollToIssue(sceneId: string, issue: ContinuityIssue): void;
}

// Helper: focused reader context builder
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
    if (Array.isArray((scene as any).plotMarkers)) {
      (scene as any).plotMarkers.forEach((p: string) => {
        context.revealedPlotPoints.push(p);
      });
    }
  });

  return context;
};

const SceneViewer = forwardRef<SceneViewerHandle>((_props, ref) => {
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
          preserveElements: [],
        }
      );

      if (result?.success && result?.rewrittenText) {
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

  const { buildHighlightsForScene, getScrollTarget } = useIssueHighlighting();

  const spans = useMemo(() => {
    if (!selectedScene) return [];
    return buildHighlightsForScene(selectedScene.id);
  }, [selectedScene, buildHighlightsForScene]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    scrollToIssue(sceneId: string, issue: ContinuityIssue) {
      const root = containerRef.current;
      if (!root) return;

      const anchorId = getScrollTarget(sceneId, issue);
      const escapeAttr = (s: string) => s.replace(/"/g, '\\"');

      let target: HTMLElement | null =
        (root.querySelector(`[id="${escapeAttr(anchorId)}"]`) as HTMLElement | null) ??
        (root.querySelector(`[data-issue-id="${escapeAttr(anchorId)}"]`) as HTMLElement | null);

      if (!target) {
        const startIdx = Array.isArray(issue.textSpan) ? Number(issue.textSpan?.[0] ?? 0) : 0;
        const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-start][data-end]'));
        let best: { el: HTMLElement; dist: number } | null = null;
        for (const el of candidates) {
          const a = Number(el.getAttribute('data-start') ?? '0');
          const b = Number(el.getAttribute('data-end') ?? '0');
          const contains = a <= startIdx && startIdx < b;
          const dist = contains ? 0 : Math.min(Math.abs(startIdx - a), Math.abs(startIdx - b));
          if (!best || dist < best.dist || (dist === best.dist && a <= startIdx)) {
            best = { el, dist };
            if (dist === 0) break;
          }
        }
        target = best?.el ?? null;
      }

      if (target) {
        try {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {
          // no-op if scrollIntoView options unsupported
          target.scrollIntoView();
        }
        // transient flash to draw attention
        target.classList.add('ring-2', 'ring-indigo-500', 'transition-shadow');
        setTimeout(() => {
          target.classList.remove('ring-2', 'ring-indigo-500', 'transition-shadow');
        }, 1200);
      }
    },
  }));

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
              <span
                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  selectedScene.rewriteStatus === 'pending'
                    ? 'bg-gray-100 text-gray-800'
                    : selectedScene.rewriteStatus === 'generated'
                    ? 'bg-blue-100 text-blue-800'
                    : selectedScene.rewriteStatus === 'approved'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {selectedScene.rewriteStatus}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scene Content */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4">
        <div className="prose max-w-none">
          <IssueHighlighter
            content={selectedScene.currentRewrite || selectedScene.text}
            spans={spans}
            className="whitespace-pre-wrap text-gray-900 leading-relaxed"
          />
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
                className={`px-3 py-1 text-sm font-medium rounded-md focus:outline-none focus:ring-2 ${
                  isGeneratingRewrite || selectedScene.rewriteStatus === 'pending'
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'text-green-700 bg-green-100 hover:bg-green-200 focus:ring-green-500'
                }`}
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
});

export default SceneViewer;
