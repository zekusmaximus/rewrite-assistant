// Core data types for the Rewrite Assistant application

// A scene is a unit of narrative
export interface Scene {
  id: string;
  text: string;
  wordCount: number;
  position: number;  // Current position in manuscript
  originalPosition: number;  // Where it started
  
  // Extracted metadata (using compromise.js or regex)
  characters: string[];
  timeMarkers: string[];  // "next morning", "three days later"
  locationMarkers: string[];
  
  // Rewrite status
  hasBeenMoved: boolean;
  rewriteStatus: 'pending' | 'generated' | 'approved' | 'rejected';
  currentRewrite?: string;
}

// Issues when scenes move
export interface ContinuityIssue {
  type: 'pronoun' | 'timeline' | 'character' | 'plot' | 'context' | 'engagement';
  severity: 'must-fix' | 'should-fix' | 'consider';
  description: string;
  textSpan: [start: number, end: number];
  suggestedFix?: string;
}

// Manuscript data structure
export interface Manuscript {
  id: string;
  title: string;
  scenes: Scene[];
  originalOrder: string[];  // Original scene IDs in order
  currentOrder: string[];   // Current scene IDs in order
  filePath?: string;
}

// IPC message types for communication between main and renderer processes
export interface IPCMessage {
  type: string;
  payload?: any;
}

export interface LoadFileMessage extends IPCMessage {
  type: 'load-file';
  payload: {
    filePath: string;
  };
}

export interface SaveFileMessage extends IPCMessage {
  type: 'save-file';
  payload: {
    filePath: string;
    content: string;
  };
}

