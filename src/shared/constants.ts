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
  LOAD_SPECIFIC_FILE: 'load-specific-file',
  AUTO_LOAD_MANUSCRIPT: 'auto-load-manuscript',
  SAVE_FILE: 'save-file',
  FILE_LOADED: 'file-loaded',
  FILE_SAVED: 'file-saved',
  // AI service channels
  ANALYZE_CONTINUITY: 'analyze-continuity',
  CONFIGURE_AI_PROVIDER: 'configure-ai-provider',
  GET_ANALYSIS_STATUS: 'get-analysis-status',
  ERROR: 'error',
  // Cache management channels
  GET_CACHE_STATS: 'cache:get_stats',
  CLEAR_ANALYSIS_CACHE: 'cache:clear_analysis_cache',
  WARM_CACHE: 'cache:warm'
};

// Default manuscript file name
export const DEFAULT_MANUSCRIPT_FILE = 'manuscript.txt';

