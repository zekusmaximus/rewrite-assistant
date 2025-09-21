import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { Manuscript, GlobalCoherenceSettings, GlobalCoherenceAnalysis, GlobalCoherenceProgress } from '../../shared/types';
import GlobalAnalysisOrchestrator from '../../services/coherence/GlobalAnalysisOrchestrator';
import type AIServiceManager from '../../services/ai/AIServiceManager';

let orchestrator: GlobalAnalysisOrchestrator | null = null;
let lastAnalysis: GlobalCoherenceAnalysis | null = null;
let currentAnalysisId: string | null = null;

export function registerGlobalCoherenceHandlers(aiManager: AIServiceManager, mainWindow: BrowserWindow): void {
  try {
    orchestrator = new GlobalAnalysisOrchestrator(aiManager, { enableCache: true });
  } catch (err) {
    console.error('[GlobalCoherence] Failed to initialize orchestrator:', err);
    // Fallback to internal AI manager if provided aiManager is problematic
    orchestrator = new GlobalAnalysisOrchestrator(undefined, { enableCache: true });
  }

  ipcMain.handle(IPC_CHANNELS.GLOBAL_COHERENCE_START, async (event: IpcMainInvokeEvent, manuscript: Manuscript, settings: GlobalCoherenceSettings) => {
    try {
      const analysisId = `analysis-${Date.now()}`;
      currentAnalysisId = analysisId;

      console.log('[GlobalCoherence] Start analysis', { analysisId, scenes: Array.isArray(manuscript?.scenes) ? manuscript.scenes.length : 0 });

      const progressCb = (p: GlobalCoherenceProgress): void => {
        try {
          if (!mainWindow || (mainWindow as any).isDestroyed?.()) return;
          mainWindow.webContents.send(IPC_CHANNELS.GLOBAL_COHERENCE_PROGRESS, { ...p, analysisId });
        } catch {
          // swallow send errors
        }
      };

      orchestrator?.analyzeGlobalCoherence(manuscript, settings, progressCb)
        .then((analysis) => {
          lastAnalysis = analysis;
          try {
            if (!mainWindow || (mainWindow as any).isDestroyed?.()) return;
            mainWindow.webContents.send(IPC_CHANNELS.GLOBAL_COHERENCE_COMPLETE, { analysis, analysisId });
          } catch {
            // swallow
          }
        })
        .catch((err) => {
          console.error('[GlobalCoherence] Analysis error', err);
          try {
            if (!mainWindow || (mainWindow as any).isDestroyed?.()) return;
            mainWindow.webContents.send(IPC_CHANNELS.GLOBAL_COHERENCE_ERROR, { error: (err instanceof Error ? err.message : String(err ?? 'Analysis failed')), analysisId });
          } catch {
            // swallow
          }
        })
        .finally(() => {
          currentAnalysisId = null;
        });

      return { success: true, analysisId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
      console.error('[GlobalCoherence] Start handler failed:', err);
      return { success: false, analysisId: '', error: message };
    }
  });

  ipcMain.on(IPC_CHANNELS.GLOBAL_COHERENCE_CANCEL, () => {
    try {
      if (orchestrator && currentAnalysisId) {
        console.log('[GlobalCoherence] Cancel requested', { analysisId: currentAnalysisId });
        try {
          orchestrator.cancelAnalysis();
        } catch {
          // swallow
        }
        try {
          if (!mainWindow || (mainWindow as any).isDestroyed?.()) return;
          mainWindow.webContents.send(IPC_CHANNELS.GLOBAL_COHERENCE_PROGRESS, { cancelled: true, analysisId: currentAnalysisId } as any);
        } catch {
          // swallow
        }
        currentAnalysisId = null;
      }
    } catch (err) {
      console.error('[GlobalCoherence] Cancel handler error:', err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.GLOBAL_COHERENCE_GET_LAST, async (): Promise<GlobalCoherenceAnalysis | null> => {
    return lastAnalysis ?? null;
  });
}

export function cleanupGlobalCoherenceHandlers(): void {
  try {
    if (orchestrator) {
      try {
        orchestrator.cancelAnalysis();
      } catch {
        // swallow
      }
    }
    ipcMain.removeHandler(IPC_CHANNELS.GLOBAL_COHERENCE_START);
    ipcMain.removeHandler(IPC_CHANNELS.GLOBAL_COHERENCE_GET_LAST);
    ipcMain.removeAllListeners(IPC_CHANNELS.GLOBAL_COHERENCE_CANCEL);
  } finally {
    orchestrator = null;
    lastAnalysis = null;
    currentAnalysisId = null;
  }
}