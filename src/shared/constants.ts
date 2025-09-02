// Shared constants for the Rewrite Assistant application

// Scene parsing markers
export const SCENE_MARKERS = {
  CHAPTER: /^(Chapter|CHAPTER)\s+\d+/i,
  SCENE: /^(Scene|SCENE)\s+\d+/i,
  SCENE_BREAK: /^###\s*SCENE\s*BREAK\s*###/i,
  DOUBLE_NEWLINE: /\n\n/
};

// Application settings
export const APP_CONFIG = {
  WINDOW_WIDTH: 1200,
  WINDOW_HEIGHT: 800,
  MIN_WINDOW_WIDTH: 800,
  MIN_WINDOW_HEIGHT: 600
};

// File types supported
export const SUPPORTED_FILE_TYPES = [
  { name: 'Text Files', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] }
];

// IPC channel names
export const IPC_CHANNELS = {
  LOAD_FILE: 'load-file',
  SAVE_FILE: 'save-file',
  FILE_LOADED: 'file-loaded',
  FILE_SAVED: 'file-saved',
  ERROR: 'error'
};

