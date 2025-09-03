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

  /**
   * Continuity analysis metadata for this scene.
   * Optional to avoid impacting existing flows; present when analysis has been performed.
   */
  continuityAnalysis?: ContinuityAnalysis;
}

// Issues when scenes move
export interface ContinuityIssue {
  type: 'pronoun' | 'timeline' | 'character' | 'plot' | 'context' | 'engagement';
  severity: 'must-fix' | 'should-fix' | 'consider';
  description: string;
  textSpan: [start: number, end: number];
  suggestedFix?: string;
}

/**
* Reader knowledge and continuity analysis types
* Note: Some placeholder interfaces are defined here to maintain shared typing.
* Replace them with canonical definitions if/when they are introduced elsewhere.
*/

// Placeholder TimelineEvent interface if not defined elsewhere
export interface TimelineEvent {
 /**
  * TODO: Replace this placeholder with the application's canonical TimelineEvent
  * definition when available. Kept minimal for backward compatibility.
  */
 label: string;
 /** Optional ISO 8601 timestamp or human-readable marker. */
 when?: string;
}

// Placeholder Location interface if not defined elsewhere
export interface Location {
 /**
  * TODO: Replace this placeholder with the application's canonical Location
  * definition when available. Kept minimal for backward compatibility.
  */
 name: string;
 /** Optional unique identifier for the location. */
 id?: string;
}

/**
* Captures what a reader would plausibly know up to a point in the manuscript.
*
* IMPORTANT: knownCharacters is a JavaScript Set, which is JSON-unsafe.
* Do not serialize directly with JSON.stringify. If you need to send this
* across IPC or persist it, provide a custom serializer/deserializer that
* converts Set<string> to/from an array.
*/
export interface ReaderKnowledge {
 /** Set of character names already introduced to the reader. */
 knownCharacters: Set<string>;
 /** Ordered timeline events established so far. */
 establishedTimeline: TimelineEvent[];
 /** Plot points revealed to the reader to date. */
 revealedPlotPoints: string[];
 /** Settings/locations that have been established. */
 establishedSettings: Location[];
}

/**
* Results of automated continuity analysis for a scene.
*/
export interface ContinuityAnalysis {
 /** Detected issues for this scene. */
 issues: ContinuityIssue[];
 /** Analysis timestamp in epoch milliseconds. */
 timestamp: number;
 /** Model identifier used to perform analysis. */
 modelUsed: string;
 /** Confidence score in range [0, 1]. */
 confidence: number;
 /** Reader context at the point of this scene. */
 readerContext: ReaderKnowledge;
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

