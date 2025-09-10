import React, { useEffect, useRef, useState } from 'react';
import { useManuscriptStore } from '../stores/manuscriptStore';
import SceneReorderer from '../features/reorder/SceneReorderer';
import SceneViewer, { type SceneViewerHandle } from '../components/SceneViewer';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import IssuePanel from '../features/analyze/components/IssuePanel';
import useAnalysis from '../features/analyze/hooks/useAnalysis';
import type { ContinuityIssue } from '../../shared/types';
import RewritePanel from '../features/rewrite/components/RewritePanel';
import { useSettingsStore } from '../features/settings/stores';
import { SettingsModal } from '../features/settings/components';
import ExportDialog from '../features/export/components/ExportDialog';
 
const App: React.FC = () => {
  const { 
    manuscript, 
    isLoading, 
    error, 
    setManuscript, 
    setLoading, 
    setError,
    clearManuscript,
    undoReorder,
    redoReorder,
    canUndo,
    canRedo
  } = useManuscriptStore();

  // Local Issues panel state and analysis hook
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [rewritePanelOpen, setRewritePanelOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const sceneViewerRef = useRef<SceneViewerHandle | null>(null);
  const { analyzeMovedScenes } = useAnalysis();
  const { openSettings } = useSettingsStore();
  const didAutoLoadRef = useRef(false);

  // Auto-load manuscript.txt on startup (once per mount; deps included for lint correctness)
  useEffect(() => {
    if (didAutoLoadRef.current) return;
    didAutoLoadRef.current = true;

    const autoLoadManuscript = async () => {
      try {
        console.log('Starting auto-load process...');
        setLoading(true);
        setError(null);

        // Try to auto-load manuscript.txt from the project root
        const loadedManuscript = await window.electronAPI?.autoLoadManuscript();

        if (loadedManuscript) {
          setManuscript(loadedManuscript);
          console.log('Auto-loaded manuscript.txt successfully with', loadedManuscript.scenes.length, 'scenes');
        } else {
          // File doesn't exist or couldn't be loaded, that's OK - user can load manually
          console.log('manuscript.txt not found or failed to load, user will need to load manually');
        }
      } catch (err) {
        // Don't show error for auto-load failures, just log it
        console.log('Auto-load failed (this is OK):', err);
      } finally {
        setLoading(false);
      }
    };

    // Only auto-load if no manuscript is currently loaded
    if (!manuscript) {
      void autoLoadManuscript();
    }
  }, [manuscript, setLoading, setError, setManuscript]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoReorder();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redoReorder();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoReorder, redoReorder]);

  // Analysis / Issues panel shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // Ctrl/Cmd + Shift + A => Open panel and analyze moved scenes
      if (isCtrlOrCmd && event.shiftKey && key === 'a') {
        event.preventDefault();
        setIssuesOpen(true);
        void analyzeMovedScenes();
        return;
      }

      // Escape => Close Issues panel only
      if (key === 'escape' && issuesOpen) {
        event.preventDefault();
        setIssuesOpen(false);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [analyzeMovedScenes, issuesOpen]);

  const handleLoadFile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const loadedManuscript = await window.electronAPI?.loadFile();
      
      if (loadedManuscript) {
        setManuscript(loadedManuscript);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!manuscript) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const savedPath = await window.electronAPI?.saveFile(manuscript);
      
      if (savedPath) {
        console.log('File saved to:', savedPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setLoading(false);
    }
  };

  const handleNewFile = () => {
    clearManuscript();
  };

  // Jump from IssuePanel to a specific issue inside the SceneViewer
  const handleShowInScene = (sceneId: string, issue: ContinuityIssue) => {
    // Ensure correct scene is selected before scrolling
    useManuscriptStore.getState().selectScene(sceneId);
    // Defer to allow SceneViewer to render highlights
    setTimeout(() => {
      sceneViewerRef.current?.scrollToIssue(sceneId, issue);
    }, 0);
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Rewrite Assistant</h1>
          <div className="flex gap-3">
            <button
              onClick={handleNewFile}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              New
            </button>
            <button
              onClick={handleLoadFile}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Load Manuscript
            </button>
            {manuscript && (
              <>
                <button
                  onClick={undoReorder}
                  disabled={!canUndo()}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Undo (Ctrl+Z)"
                >
                  ↶ Undo
                </button>
                <button
                  onClick={redoReorder}
                  disabled={!canRedo()}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Redo (Ctrl+Y)"
                >
                  ↷ Redo
                </button>
                <button
                  onClick={handleSaveFile}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  Save
                </button>
                <button
                  onClick={() => setExportDialogOpen(true)}
                  className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 border border-transparent rounded-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  title="Export manuscript with rewrites"
                >
                  📤 Export
                </button>
                <button
                  onClick={async () => {
                    setIssuesOpen(true);
                    await analyzeMovedScenes();
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  title="Find Issues (Ctrl+Shift+A)"
                >
                  🔍 Find Issues
                </button>
                <button
                  onClick={() => setRewritePanelOpen(!rewritePanelOpen)}
                  className="px-4 py-2 text-sm font-medium text-purple-700 bg-purple-100 rounded-md hover:bg-purple-200"
                >
                  Rewrite Panel
                </button>
                <button
                  onClick={() => {
                    console.log('[App] Settings clicked');
                    openSettings();
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  ⚙️ Settings
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Error Display */}
      {error && (
        <div className="px-6 py-2">
          <ErrorMessage message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {manuscript ? (
          <>
            {/* Scene List (Left Panel) */}
            <div className="w-1/2 border-r border-gray-200 bg-white">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  {manuscript.title}
                </h2>
                <p className="text-sm text-gray-600">
                  {manuscript.scenes.length} scenes
                  {manuscript.scenes.some(s => s.hasBeenMoved) && (
                    <span className="ml-2 text-yellow-600">
                      • {manuscript.scenes.filter(s => s.hasBeenMoved).length} moved
                    </span>
                  )}
                </p>
              </div>
              <SceneReorderer />
            </div>

            {/* Scene Content (Right Panel) */}
            <div className="flex-1 bg-white">
              <SceneViewer ref={sceneViewerRef} />
            </div>
            {manuscript && rewritePanelOpen && (
              <div className="w-96 bg-gray-50 border-l border-gray-200 overflow-hidden flex flex-col">
                <RewritePanel />
              </div>
            )}
          </>
        ) : (
          /* Welcome Screen */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No manuscript loaded
              </h3>
              <p className="text-gray-600 mb-6">
                Load a text file to start reordering and rewriting your scenes.
              </p>
              <button
                onClick={handleLoadFile}
                className="px-6 py-3 text-base font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Load Manuscript
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Issues Bottom Panel (collapsible) */}
      {issuesOpen && (
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <IssuePanel
            isOpen={issuesOpen}
            onClose={() => setIssuesOpen(false)}
            onShowInScene={(sceneId, issue) => handleShowInScene(sceneId, issue)}
          />
        </div>
      )}

      <SettingsModal />
      {exportDialogOpen && (
        <ExportDialog
          isOpen={exportDialogOpen}
          onClose={() => setExportDialogOpen(false)}
        />
      )}
    </div>
  );
};

export default App;

