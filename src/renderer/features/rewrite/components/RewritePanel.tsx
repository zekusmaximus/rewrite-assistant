import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useRewriteStore from '../stores/rewriteStore';
import RewriteProgress from './RewriteProgress';
import RewriteHistory from './RewriteHistory';
import type { Scene } from '../../../../shared/types';
import { useAIStatusStore } from '../../../stores/aiStatusStore';
import { useSettingsStore } from '../../settings/stores/useSettingsStore';

interface RewritePanelProps {
  className?: string;
}

const RewritePanel: React.FC<RewritePanelProps> = ({ className = '' }) => {
  const manuscript = useManuscriptStore(state => state.manuscript);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'batch' | 'history'>('overview');

  const status = useAIStatusStore((s) => s.status);
  const checkStatus = useAIStatusStore((s) => s.checkStatus);
  const requireAI = useAIStatusStore((s) => s.requireAI);
  const openSettings = useSettingsStore((s) => s.openSettings);

  // Ensure AI status is fresh on mount
  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const {
    sceneRewrites,
    isBatchRewriting,
    batchProgress,
    startBatchRewrite,
    cancelBatchRewrite,
    clearAllRewrites,
  } = useRewriteStore();
  
  // Calculate statistics
  const stats = useMemo(() => {
    if (!manuscript) return null;
    
    const movedScenes = manuscript.scenes.filter(s => s.hasBeenMoved);
    const scenesWithIssues = movedScenes.filter(s =>
      (s.continuityAnalysis?.issues?.length ?? 0) > 0
    );
    const scenesWithRewrites = Array.from(sceneRewrites.keys());
    const appliedRewrites = manuscript.scenes.filter(s => s.rewriteStatus === 'approved');
    
    return {
      moved: movedScenes.length,
      withIssues: scenesWithIssues.length,
      rewritten: scenesWithRewrites.length,
      applied: appliedRewrites.length
    };
  }, [manuscript, sceneRewrites]);
  
  const handleStartBatch = useCallback(async () => {
    try {
      // Enforce AI availability for this feature
      requireAI('Content Rewriting');
      await startBatchRewrite({
        skipIfNoIssues: true
      });
    } catch (error) {
      const err = error as unknown;
      const code = (err as any)?.code as string | undefined;
      const name = (err as Error | undefined)?.name;
      if (code === 'AI_UNAVAILABLE' || name === 'AIUnavailableError') {
        // Refresh status; UI will switch to configuration prompt if unavailable
        await checkStatus();
        return;
      }
      // Preserve existing behavior: rethrow for unexpected errors
      throw error;
    }
  }, [startBatchRewrite, requireAI, checkStatus]);

  // Loading state while AI status is being checked
  if (status.isChecking) {
    return (
      <div className={['rounded-md border border-gray-300 bg-gray-50 p-4', className].filter(Boolean).join(' ')}>
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-gray-400 border-t-transparent rounded-full" />
          <div>
            <div className="font-semibold text-gray-900">Checking AI Services...</div>
            <div className="text-sm text-gray-600 mt-1">Verifying API keys and provider availability</div>
          </div>
        </div>
      </div>
    );
  }

  // Block all rewrite functionality when AI is unavailable
  if (!status.isChecking && !status.available) {
    return (
      <div
        className={['rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900', className].filter(Boolean).join(' ')}
        role="status"
        aria-live="polite"
        title={status.lastChecked ? `Last checked: ${new Date(status.lastChecked).toLocaleString()}` : undefined}
      >
        <div className="mb-2">
          <h3 className="font-semibold text-amber-900">AI Required: Content Rewriting</h3>
        </div>
        <p className="mb-3">This feature needs at least one working AI provider. Add or fix your API keys in Settings.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (typeof openSettings === 'function') {
                openSettings();
              } else {
                const storeAny = useSettingsStore as unknown as { getState?: () => any };
                const state = storeAny?.getState?.();
                if (typeof state?.setIsOpen === 'function') {
                  state.setIsOpen(true);
                } else if (typeof state?.setIsSettingsOpen === 'function') {
                  state.setIsSettingsOpen(true);
                } else {
                  console.warn('[RewritePanel] No settings open handler available.');
                }
              }
            }}
            className="text-amber-800 underline decoration-amber-400 hover:text-amber-900"
            aria-label="Open Settings"
          >
            Open Settings
          </button>
          <button
            type="button"
            onClick={() => { void checkStatus(); }}
            className="px-2 py-1 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
            aria-label="Refresh AI status"
          >
            Refresh Status
          </button>
        </div>
      </div>
    );
  }

  if (!manuscript || !stats) {
    return (
      <div className={`p-4 text-center text-gray-500 ${className}`}>
        Load a manuscript to begin rewriting
      </div>
    );
  }
  
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-4 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Rewrite Management
          </h2>
        </div>
        <div className="flex mt-4">
          <button
            onClick={() => setSelectedTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedTab === 'overview'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-600 border-transparent hover:text-gray-900'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setSelectedTab('batch')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedTab === 'batch'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-600 border-transparent hover:text-gray-900'
            }`}
          >
            Batch Process
          </button>
          <button
            onClick={() => setSelectedTab('history')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedTab === 'history'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-600 border-transparent hover:text-gray-900'
            }`}
          >
            History
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-auto">
        {selectedTab === 'overview' && (
          <div className="p-4">
            {/* Statistics Cards */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-900">{stats.moved}</div>
                <div className="text-sm text-gray-600">Moved Scenes</div>
              </div>
              <div className="bg-white p-4 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-amber-600">{stats.withIssues}</div>
                <div className="text-sm text-gray-600">Need Rewriting</div>
              </div>
              <div className="bg-white p-4 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-blue-600">{stats.rewritten}</div>
                <div className="text-sm text-gray-600">Rewrites Ready</div>
              </div>
              <div className="bg-white p-4 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-green-600">{stats.applied}</div>
                <div className="text-sm text-gray-600">Applied</div>
              </div>
            </div>
            
            {/* Scene List with Status */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">
                  Scenes Requiring Attention
                </h3>
              </div>
              <div className="divide-y divide-gray-200">
                {manuscript.scenes
                  .filter(scene => scene.hasBeenMoved && ((scene.continuityAnalysis?.issues?.length ?? 0) > 0))
                  .map(scene => (
                    <SceneRewriteStatus key={scene.id} scene={scene} />
                  ))}
                {stats.withIssues === 0 && (
                  <div className="px-4 py-8 text-center text-gray-500">
                    No scenes require rewriting
                  </div>
                )}
              </div>
            </div>
            
            {/* Quick Actions */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleStartBatch}
                disabled={stats.withIssues === 0 || isBatchRewriting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Rewrite All ({stats.withIssues} scenes)
              </button>
              {stats.rewritten > 0 && (
                <button
                  onClick={clearAllRewrites}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Clear All Rewrites
                </button>
              )}
            </div>
          </div>
        )}
        
        {selectedTab === 'batch' && (
          <div className="p-4">
            <RewriteProgress
              progress={batchProgress}
              isRunning={isBatchRewriting}
              onCancel={cancelBatchRewrite}
              onStart={handleStartBatch}
            />
          </div>
        )}
        
        {selectedTab === 'history' && (
          <div className="p-4">
            <RewriteHistory
              sceneRewrites={sceneRewrites}
              manuscript={manuscript}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// Sub-component for scene status in overview
const SceneRewriteStatus: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { hasRewrite, generateRewrite } = useRewriteStore();
  const hasRewriteReady = hasRewrite(scene.id);
  const issueCount = scene.continuityAnalysis?.issues?.length || 0;

  const checkStatus = useAIStatusStore((s) => s.checkStatus);
  const requireAI = useAIStatusStore((s) => s.requireAI);

  const handleGenerate = useCallback(async () => {
    try {
      // Enforce AI availability for this feature
      requireAI('Content Rewriting');
      await generateRewrite(scene.id);
    } catch (error) {
      const err = error as unknown;
      const code = (err as any)?.code as string | undefined;
      const name = (err as Error | undefined)?.name;
      if (code === 'AI_UNAVAILABLE' || name === 'AIUnavailableError') {
        await checkStatus();
        return;
      }
      throw error;
    }
  }, [requireAI, generateRewrite, scene.id, checkStatus]);
  
  return (
    <div className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
      <div>
        <div className="text-sm font-medium text-gray-900">
          Scene {scene.position + 1}
        </div>
        <div className="text-xs text-gray-600 mt-1">
          {issueCount} issue{issueCount !== 1 ? 's' : ''} to fix
        </div>
      </div>
      <div className="flex items-center gap-2">
        {scene.rewriteStatus === 'approved' && (
          <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">
            Applied
          </span>
        )}
        {hasRewriteReady && scene.rewriteStatus !== 'approved' && (
          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
            Ready
          </span>
        )}
        {!hasRewriteReady && (
          <button
            onClick={handleGenerate}
            className="text-xs px-3 py-1 text-blue-600 hover:bg-blue-50 rounded"
          >
            Generate
          </button>
        )}
      </div>
    </div>
  );
};

export default RewritePanel;