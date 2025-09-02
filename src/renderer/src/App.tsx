import React, { useEffect } from 'react';
import { useManuscriptStore } from '../stores/manuscriptStore';
import SceneReorderer from '../features/reorder/SceneReorderer';
import SceneViewer from '../components/SceneViewer';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

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

  const handleLoadFile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // For now, just simulate loading since we need to fix the electronAPI first
      setTimeout(() => {
        setLoading(false);
        console.log('Simulated file load complete');
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
      setLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!manuscript) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // Simulate saving
      setTimeout(() => {
        setLoading(false);
        console.log('File saved');
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
      setLoading(false);
    }
  };

  const handleNewFile = () => {
    clearManuscript();
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
            <div className="w-1/2 bg-white">
              <SceneViewer />
            </div>
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
    </div>
  );
};

export default App;

