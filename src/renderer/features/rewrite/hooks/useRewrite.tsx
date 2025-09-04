import { useCallback, useMemo } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useRewriteStore from '../stores/rewriteStore';
import type { Scene } from '../../../../shared/types';

export function useRewrite(sceneId?: string) {
  const manuscript = useManuscriptStore(state => state.manuscript);
  const scene = useMemo<Scene | null>(() => {
    if (!sceneId || !manuscript) return null;
    return manuscript.scenes.find(s => s.id === sceneId) || null;
  }, [sceneId, manuscript]);
  
  const {
    isRewriting,
    currentRewriteSceneId,
    rewriteProgress,
    generateRewrite,
    hasRewrite,
    getLatestRewrite,
    applyRewrite,
    rejectRewrite,
    clearRewrite
  } = useRewriteStore();
  
  const isGenerating = useMemo(() => {
    return Boolean(sceneId) && isRewriting && currentRewriteSceneId === sceneId;
  }, [isRewriting, currentRewriteSceneId, sceneId]);
  
  const rewriteStatus = useMemo<null | 'generating' | 'applied' | 'rejected' | 'ready' | 'none'>(() => {
    if (!sceneId) return null;
    if (isGenerating) return 'generating';
    if (hasRewrite(sceneId)) {
      const latest = getLatestRewrite(sceneId);
      if (latest?.appliedToManuscript) return 'applied';
      if (scene?.rewriteStatus === 'rejected') return 'rejected';
      return 'ready';
    }
    return 'none';
  }, [sceneId, isGenerating, hasRewrite, getLatestRewrite, scene]);
  
  const generateRewriteForScene = useCallback(async () => {
    if (!sceneId) return;
    await generateRewrite(sceneId);
  }, [sceneId, generateRewrite]);
  
  const applyRewriteForScene = useCallback(() => {
    if (!sceneId) return;
    applyRewrite(sceneId);
  }, [sceneId, applyRewrite]);
  
  const rejectRewriteForScene = useCallback(() => {
    if (!sceneId) return;
    rejectRewrite(sceneId);
  }, [sceneId, rejectRewrite]);
  
  const clearRewriteForScene = useCallback(() => {
    if (!sceneId) return;
    clearRewrite(sceneId);
  }, [sceneId, clearRewrite]);
  
  return {
    scene,
    isGenerating,
    rewriteStatus,
    rewriteProgress: isGenerating ? rewriteProgress : null,
    generateRewrite: generateRewriteForScene,
    applyRewrite: applyRewriteForScene,
    rejectRewrite: rejectRewriteForScene,
    clearRewrite: clearRewriteForScene,
    hasRewrite: sceneId ? hasRewrite(sceneId) : false,
    latestRewrite: sceneId ? getLatestRewrite(sceneId) : null
  };
}

export default useRewrite;