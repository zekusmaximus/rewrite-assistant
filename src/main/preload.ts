import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { Manuscript, GlobalCoherenceSettings, GlobalCoherenceAnalysis, GlobalCoherenceProgress } from '../shared/types';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  loadFile: (): Promise<Manuscript | null> => ipcRenderer.invoke(IPC_CHANNELS.LOAD_FILE),
  loadSpecificFile: (filePath: string): Promise<Manuscript | null> => ipcRenderer.invoke(IPC_CHANNELS.LOAD_SPECIFIC_FILE, filePath),
  autoLoadManuscript: (): Promise<Manuscript | null> => ipcRenderer.invoke(IPC_CHANNELS.AUTO_LOAD_MANUSCRIPT),
  saveFile: (manuscript: Manuscript): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FILE, manuscript),

  // AI provider configuration (no logging of secrets)
  configureProviders: (config: any) => ipcRenderer.invoke(IPC_CHANNELS.CONFIGURE_AI_PROVIDER, config),
  testProvider: (provider: string, config: any) =>
    ipcRenderer.invoke('test-ai-provider', { provider, config }),
  
  // Settings (secure, via main process)
  loadSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LOAD),
  saveSettings: (settings: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),
  testConnection: (params: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_TEST_CONNECTION, params),

  // Global coherence analysis bridge
  globalCoherence: {
    start: (manuscript: Manuscript, settings: GlobalCoherenceSettings): Promise<{ success: boolean; analysisId: string; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.GLOBAL_COHERENCE_START, manuscript, settings),

    cancel: (): void => {
      ipcRenderer.send(IPC_CHANNELS.GLOBAL_COHERENCE_CANCEL);
    },

    onProgress: (cb: (progress: GlobalCoherenceProgress & { analysisId: string }) => void) => {
      const listener = (_event: unknown, data: GlobalCoherenceProgress & { analysisId: string }) => cb(data);
      ipcRenderer.on(IPC_CHANNELS.GLOBAL_COHERENCE_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.GLOBAL_COHERENCE_PROGRESS, listener);
      };
    },

    onComplete: (cb: (data: { analysis: GlobalCoherenceAnalysis; analysisId: string }) => void) => {
      const listener = (_event: unknown, data: { analysis: GlobalCoherenceAnalysis; analysisId: string }) => cb(data);
      ipcRenderer.on(IPC_CHANNELS.GLOBAL_COHERENCE_COMPLETE, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.GLOBAL_COHERENCE_COMPLETE, listener);
      };
    },

    onError: (cb: (data: { error: string; analysisId: string }) => void) => {
      const listener = (_event: unknown, data: { error: string; analysisId: string }) => cb(data);
      ipcRenderer.on(IPC_CHANNELS.GLOBAL_COHERENCE_ERROR, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.GLOBAL_COHERENCE_ERROR, listener);
      };
    },

    getLastAnalysis: (): Promise<GlobalCoherenceAnalysis | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GLOBAL_COHERENCE_GET_LAST),
  },
  
  // Platform info
  platform: process.platform,
  
  // Version info
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }
});

// Expose a minimal ipcRenderer bridge to support invoke-based workflows (used by rewrite store/UI)
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  }
});

// Type definitions for the exposed API
declare global {
 interface Window {
   electronAPI: {
     // File ops
     loadFile: () => Promise<Manuscript | null>;
     loadSpecificFile: (filePath: string) => Promise<Manuscript | null>;
     autoLoadManuscript: () => Promise<Manuscript | null>;
     saveFile: (manuscript: Manuscript) => Promise<string | null>;

     // AI provider endpoints
     configureProviders: (config: any) => Promise<any>;
     testProvider: (
       provider: string,
       config: any
     ) => Promise<{ ok: boolean; error?: { message: string; code: string } }>;
 
     // Settings
     loadSettings: () => Promise<any>;
     saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
     testConnection: (params: any) => Promise<{ success: boolean; error?: string }>;

     // Global coherence analysis bridge
     globalCoherence: {
       start(manuscript: Manuscript, settings: GlobalCoherenceSettings): Promise<{ success: boolean; analysisId: string; error?: string }>;
       cancel(): void;
       onProgress(cb: (progress: GlobalCoherenceProgress & { analysisId: string }) => void): () => void;
       onComplete(cb: (data: { analysis: GlobalCoherenceAnalysis; analysisId: string }) => void): () => void;
       onError(cb: (data: { error: string; analysisId: string }) => void): () => void;
       getLastAnalysis(): Promise<GlobalCoherenceAnalysis | null>;
     };

     // Env info
     platform: string;
     versions: {
       node: string;
       chrome: string;
       electron: string;
     };
   };
   // Minimal ipc bridge typing (only what's exposed)
   electron: {
     ipcRenderer: {
       invoke: (channel: string, ...args: any[]) => Promise<any>;
     };
   };
 }
}

