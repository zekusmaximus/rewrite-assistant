import { ipcMain, dialog } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mainWindow } from './index';
import { IPC_CHANNELS, SUPPORTED_FILE_TYPES, DEFAULT_MANUSCRIPT_FILE } from '../shared/constants';
import { Manuscript, Scene } from '../shared/types';

// Scene parsing utility
function parseManuscriptIntoScenes(content: string, filePath: string): Manuscript {
  const lines = content.split('\n');
  const scenes: Scene[] = [];
  
  // Find all SCENE markers in your specific format: [SCENE: CHxx_Syy ...]
  const sceneBreaks: number[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Only split on actual scene markers, not chapter headers
    if (line.match(/^\[SCENE:\s*CH\d+_S\d+/i)) {
      sceneBreaks.push(i);
    }
  }
  
  // If no scene markers found, fall back to other patterns
  if (sceneBreaks.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^===\s*(Chapter|CHAPTER)\s+\d+\s*===/i) ||
          line.match(/^(Chapter|CHAPTER|Scene|SCENE)\s+\d+/i) || 
          line.match(/^###\s*SCENE\s*BREAK\s*###/i)) {
        if (i > 0) sceneBreaks.push(i);
      }
    }
  }
  
  // If still no markers found, split on double newlines
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
    // Add the end of file as the final break
    sceneBreaks.push(lines.length);
    
    // Start from the beginning of the file for the first scene
    let startLine = 0;
    
    for (let i = 0; i < sceneBreaks.length; i++) {
      const endLine = sceneBreaks[i];
      const sceneText = lines.slice(startLine, endLine).join('\n').trim();
      
      // Only create a scene if there's meaningful content
      if (sceneText.length > 50) { // Minimum length to avoid empty or header-only scenes
        // Find the scene identifier in this chunk
        let sceneId = `scene-${scenes.length + 1}`;
        
        // Look for the scene marker in this text chunk
        const sceneLines = sceneText.split('\n');
        for (const line of sceneLines) {
          const sceneMatch = line.match(/^\[SCENE:\s*(CH\d+_S\d+)/i);
          if (sceneMatch) {
            sceneId = sceneMatch[1].toLowerCase();
            break;
          }
        }
        
        // If this is the first scene and no scene marker found, look for chapter info
        if (sceneId.startsWith('scene-') && scenes.length === 0) {
          for (const line of sceneLines) {
            const chapterMatch = line.match(/^===\s*(Chapter|CHAPTER)\s+(\d+)\s*===/i);
            if (chapterMatch) {
              sceneId = `ch${chapterMatch[2].padStart(2, '0')}_s01`;
              break;
            }
          }
        }
        
        const scene: Scene = {
          id: sceneId,
          text: sceneText,
          wordCount: sceneText.split(/\s+/).length,
          position: scenes.length,
          originalPosition: scenes.length,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        };
        scenes.push(scene);
      }
      
      // Next scene starts where this one ended
      startLine = endLine;
    }
  }
  
  console.log('Scene parsing complete:', {
    totalScenes: scenes.length,
    sceneIds: scenes.slice(0, 5).map(s => s.id), // First 5 scene IDs for debugging
    expectedScenes: sceneBreaks.length > 0 ? sceneBreaks.length : 'unknown'
  });
  
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
  // Handle file loading with dialog
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

  // Handle loading specific file without dialog
  ipcMain.handle(IPC_CHANNELS.LOAD_SPECIFIC_FILE, async (event, filePath: string) => {
    try {
      // Check if file exists
      if (!await fs.access(filePath).then(() => true).catch(() => false)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      const manuscript = parseManuscriptIntoScenes(content, filePath);
      
      return manuscript;
    } catch (error) {
      console.error('Error loading specific file:', error);
      throw error;
    }
  });

  // Handle auto-loading manuscript.txt from the project root
  ipcMain.handle(IPC_CHANNELS.AUTO_LOAD_MANUSCRIPT, async () => {
    try {
      // Get the directory where the app is running from
      const appPath = process.cwd();
      const manuscriptPath = path.join(appPath, DEFAULT_MANUSCRIPT_FILE);
      
      console.log('Auto-load: Checking for manuscript at:', manuscriptPath);
      
      // Check if manuscript.txt exists
      if (!await fs.access(manuscriptPath).then(() => true).catch(() => false)) {
        console.log('Auto-load: manuscript.txt not found');
        return null; // File doesn't exist, that's OK
      }
      
      console.log('Auto-load: Found manuscript.txt, parsing...');
      const content = await fs.readFile(manuscriptPath, 'utf-8');
      const manuscript = parseManuscriptIntoScenes(content, manuscriptPath);
      
      console.log('Auto-load: Successfully parsed manuscript with', manuscript.scenes.length, 'scenes');
      
      return manuscript;
    } catch (error) {
      console.error('Error auto-loading manuscript:', error);
      return null; // Don't throw for auto-load failures
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

