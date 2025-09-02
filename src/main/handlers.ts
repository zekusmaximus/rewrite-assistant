import { ipcMain, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { mainWindow } from './index';
import { IPC_CHANNELS, SUPPORTED_FILE_TYPES } from '../shared/constants';
import { Scene, Manuscript } from '../shared/types';

// Scene parsing utility
function parseManuscriptIntoScenes(content: string, filePath: string): Manuscript {
  const lines = content.split('\n');
  const scenes: Scene[] = [];
  let currentSceneText = '';
  let sceneCounter = 0;
  
  // Simple scene splitting - look for chapter/scene markers or double newlines
  const sceneBreaks: number[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check for chapter/scene markers
    if (line.match(/^(Chapter|CHAPTER|Scene|SCENE)\s+\d+/i) || 
        line.match(/^###\s*SCENE\s*BREAK\s*###/i)) {
      if (i > 0) sceneBreaks.push(i);
    }
  }
  
  // If no explicit markers found, split on double newlines
  if (sceneBreaks.length === 0) {
    const chunks = content.split(/\n\s*\n/);
    chunks.forEach((chunk, index) => {
      if (chunk.trim().length > 0) {
        const scene: Scene = {
          id: `scene-${index + 1}`,
          text: chunk.trim(),
          wordCount: chunk.trim().split(/\s+/).length,
          position: index,
          originalPosition: index,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        };
        scenes.push(scene);
      }
    });
  } else {
    // Split based on found markers
    sceneBreaks.unshift(0); // Add start
    sceneBreaks.push(lines.length); // Add end
    
    for (let i = 0; i < sceneBreaks.length - 1; i++) {
      const startLine = sceneBreaks[i];
      const endLine = sceneBreaks[i + 1];
      const sceneText = lines.slice(startLine, endLine).join('\n').trim();
      
      if (sceneText.length > 0) {
        const scene: Scene = {
          id: `scene-${i + 1}`,
          text: sceneText,
          wordCount: sceneText.split(/\s+/).length,
          position: i,
          originalPosition: i,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        };
        scenes.push(scene);
      }
    }
  }
  
  const manuscript: Manuscript = {
    id: `manuscript-${Date.now()}`,
    title: path.basename(filePath, '.txt'),
    scenes,
    originalOrder: scenes.map(s => s.id),
    currentOrder: scenes.map(s => s.id),
    filePath
  };
  
  return manuscript;
}

export function setupIPCHandlers(): void {
  // Handle file loading
  ipcMain.handle(IPC_CHANNELS.LOAD_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: SUPPORTED_FILE_TYPES
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      
      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf-8');
      const manuscript = parseManuscriptIntoScenes(content, filePath);
      
      return manuscript;
    } catch (error) {
      console.error('Error loading file:', error);
      throw error;
    }
  });
  
  // Handle file saving
  ipcMain.handle(IPC_CHANNELS.SAVE_FILE, async (event, manuscript: Manuscript) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: manuscript.filePath || `${manuscript.title}.txt`,
        filters: SUPPORTED_FILE_TYPES
      });
      
      if (result.canceled || !result.filePath) {
        return null;
      }
      
      // Reconstruct manuscript text from scenes in current order
      const orderedScenes = manuscript.currentOrder.map(id => 
        manuscript.scenes.find(scene => scene.id === id)
      ).filter(Boolean) as Scene[];
      
      const content = orderedScenes.map(scene => scene.text).join('\n\n');
      
      await fs.writeFile(result.filePath, content, 'utf-8');
      
      return result.filePath;
    } catch (error) {
      console.error('Error saving file:', error);
      throw error;
    }
  });
}

