import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { Manuscript } from '../shared/types';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  loadFile: (): Promise<Manuscript | null> => ipcRenderer.invoke(IPC_CHANNELS.LOAD_FILE),
  saveFile: (manuscript: Manuscript): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FILE, manuscript),
  
  // Platform info
  platform: process.platform,
  
  // Version info
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      loadFile: () => Promise<Manuscript | null>;
      saveFile: (manuscript: Manuscript) => Promise<string | null>;
      platform: string;
      versions: {
        node: string;
        chrome: string;
        electron: string;
      };
    };
  }
}

