import type { Manuscript, GlobalCoherenceSettings, GlobalCoherenceAnalysis, GlobalCoherenceProgress } from '../shared/types';

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

export {};