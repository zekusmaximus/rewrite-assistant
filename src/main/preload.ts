import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { Manuscript } from '../shared/types';

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

