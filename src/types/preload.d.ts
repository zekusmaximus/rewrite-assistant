import type { Manuscript } from '../shared/types';

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