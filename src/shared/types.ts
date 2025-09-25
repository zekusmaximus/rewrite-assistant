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

  // Optional rewrite history metadata
  rewriteHistory?: RewriteVersion[];
  lastRewriteTimestamp?: number;

  // Global coherence context for scene placement
  globalCoherenceContext?: {
    transitionQualityBefore?: number; // From previous scene
    transitionQualityAfter?: number; // To next scene
    sequenceFlowScore?: number;
    chapterPosition?: 'opening' | 'middle' | 'closing';
    narrativeFunction?: 'setup' | 'conflict' | 'revelation' | 'resolution';
  };
}

 // Issues when scenes move
 export interface ContinuityIssue {
   type: 'pronoun' | 'timeline' | 'character' | 'plot' | 'context' | 'engagement';
   severity: 'must-fix' | 'should-fix' | 'consider';
   description: string;
   textSpan: [start: number, end: number];
   suggestedFix?: string;
   /**
    * Optional global coherence annotation when available.
    * transitionScoreBefore/After are transition-quality scores (0..1) for boundaries adjacent to this scene.
    * affectsNarrativeFlow indicates this issue correlates with broader flow/pacing/transition concerns.
    */
   globalContext?: {
     transitionScoreBefore?: number;
     transitionScoreAfter?: number;
     affectsNarrativeFlow: boolean;
   };
 }

export type IssueSeverity = ContinuityIssue['severity'];

/**
* Reader knowledge and continuity analysis types
* Note: Some placeholder interfaces are defined here to maintain shared typing.
* Replace them with canonical definitions if/when they are introduced elsewhere.
*/

/**
 * A narrative timeline event known to the reader.
 * Notes:
 * - id is optional; provide when deduplication or updates are required.
 * - when should be an ISO-8601 string for stable lexicographic ordering when available.
 *   Epoch milliseconds are acceptable; prefer strings for consistency and readability.
 * - timestamp is deprecated; prefer when. If both present, when should be treated as source of truth.
 */
export interface TimelineEvent {
  /** Optional stable identifier for cross-referencing or deduplication */
  id?: string;
  /** Human-readable label, e.g., Day 1, Next morning, 2025-01-01 */
  label: string;
  /**
   * Absolute or relative time:
   * - ISO-8601 date or datetime string preferred (e.g., 2025-01-01 or 2025-01-01T00:00:00Z)
   * - Epoch milliseconds accepted when needed
   * - null indicates unknown/unspecified
   */
  when?: string | number | null;

  /** Optional freeform narrative details */
  description?: string;
  /** Optional backreference to the originating scene */
  sceneId?: string;

  /** Classification of timing semantics */
  type?: 'absolute' | 'relative' | 'narrative';
  /** Raw relative cue when type is relative, e.g., next morning */
  relativeMarker?: string;
  /** Narrative ordering index when no absolute time exists */
  narrativePosition?: number;

  /**
   * Deprecated in favor of when. If present, treat as epoch ms equivalent.
   */
  timestamp?: number;
}

/**
 * A setting/location known to the reader.
 * Notes:
 * - id is optional; supply when available for joins, dedupe, or UI selection.
 */
export interface Location {
  /** Optional stable identifier for joins/deduplication */
  id?: string;
  /** Display name as referenced in text */
  name: string;

  /** Optional descriptive details */
  description?: string;
  /** Scene id where first mentioned (if tracked) */
  firstMentionedIn?: string;
  /** Alternate names or spellings */
  aliases?: string[];
  /** Broad category for formatting/use */
  type?: 'interior' | 'exterior' | 'abstract';
  /** Parent location id/name for hierarchical relations */
  parentLocation?: string;
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
 payload?: unknown;
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


// ADD these new interfaces - do not modify existing ones

export interface RewriteVersion {
  id: string;
  sceneId: string;
  timestamp: number;
  rewrittenText: string;
  issuesAddressed: ContinuityIssue[];
  changesExplanation: string;
  modelUsed: string;
  userEdited: boolean;
  appliedToManuscript: boolean;
}

// Global Coherence Analysis Types
export interface GlobalCoherenceAnalysis {
  // Three-tier analysis structure
  sceneLevel: ScenePairAnalysis[];      // Adjacent scene transitions
  chapterLevel: ChapterFlowAnalysis[];   // Chapter-by-chapter coherence
  manuscriptLevel: ManuscriptAnalysis;   // Full narrative arc
  
  // Aggregated findings mapped to scenes
  flowIssues: NarrativeFlowIssue[];
  pacingProblems: PacingIssue[];
  thematicBreaks: ThematicDiscontinuity[];
  characterArcDisruptions: CharacterArcIssue[];
  
  // Metadata
  timestamp: number;
  totalAnalysisTime: number;
  modelsUsed: Record<string, string>; // passType -> model
  settings: GlobalCoherenceSettings;
}

export interface ScenePairAnalysis {
  sceneAId: string;
  sceneBId: string;
  position: number; // Position in manuscript
  transitionScore: number; // 0.0-1.0
  
  issues: {
    type: 'jarring_pace_change' | 'emotional_whiplash' | 'time_gap' | 'location_jump' | 'unresolved_tension';
    severity: IssueSeverity;
    description: string;
    suggestion: string;
  }[];
  
  strengths: string[];
  flags: {
    needsSceneBreak: boolean;
    needsTransitionScene: boolean;
    chapterBoundaryCandidate: boolean;
  };
}

export interface ChapterFlowAnalysis {
  chapterNumber: number;
  sceneIds: string[];
  coherenceScore: number; // 0.0-1.0
  
  issues: {
    unity: boolean;
    completeness: boolean;
    balancedPacing: boolean;
    narrativePurpose: boolean;
  };
  
  recommendations: {
    shouldSplit: boolean;
    shouldMergeWithNext: boolean;
    orphanedScenes: string[];
    missingElements: string[];
  };
  
  pacingProfile: {
    frontLoaded: boolean;
    saggyMiddle: boolean;
    rushedEnding: boolean;
  };
}

export interface ManuscriptAnalysis {
  structuralIntegrity: number; // 0.0-1.0
  actBalance: [number, number, number]; // Percentage per act
  
  characterArcs: Map<string, {
    completeness: number;
    consistency: number;
    issues: string[];
  }>;
  
  plotHoles: string[];
  unresolvedElements: string[];
  
  pacingCurve: {
    slowSpots: Array<{ startScene: string; endScene: string; reason: string }>;
    rushedSections: Array<{ startScene: string; endScene: string; reason: string }>;
  };
  
  thematicCoherence: number; // 0.0-1.0
  openingEffectiveness: number; // 0.0-1.0
  endingSatisfaction: number; // 0.0-1.0
}

export interface NarrativeFlowIssue extends Omit<ContinuityIssue, 'type'> {
  type: 'flow';
  affectedScenes: string[]; // Multiple scenes impacted
  pattern: 'broken_causality' | 'passive_sequence' | 'info_dump' | 'info_gap';
}

export interface PacingIssue extends Omit<ContinuityIssue, 'type'> {
  type: 'pacing';
  affectedScenes: string[];
  pattern: 'too_slow' | 'too_fast' | 'inconsistent';
  tensionDelta: number; // Change in tension level
}

export interface ThematicDiscontinuity extends Omit<ContinuityIssue, 'type'> {
  type: 'theme';
  theme: string;
  lastSeenScene: string;
  brokenAtScene: string;
}

export interface CharacterArcIssue extends Omit<ContinuityIssue, 'type'> {
  type: 'character_arc';
  characterName: string;
  arcType: 'incomplete' | 'inconsistent' | 'regressed';
  affectedScenes: string[];
}

export interface GlobalCoherenceSettings {
  // Pass selection
  enableTransitions: boolean;
  enableSequences: boolean;
  enableChapters: boolean;
  enableArc: boolean;
  enableSynthesis: boolean;
  
  // Analysis depth
  depth: 'quick' | 'standard' | 'thorough';
  
  // Cost control
  maxCost?: number;
  stopOnCritical?: boolean;
  
  // Model overrides (optional)
  modelOverrides?: Partial<Record<string, string>>;
}

export interface GlobalCoherenceProgress {
  currentPass: 'transitions' | 'sequences' | 'chapters' | 'arc' | 'synthesis';
  passNumber: number;
  totalPasses: number;
  passProgress: number; // 0-100
  
  currentScene?: string;
  scenesAnalyzed: number;
  totalScenes: number;
  
  partialResults?: Partial<GlobalCoherenceAnalysis>;
  estimatedTimeRemaining: number; // seconds
  
  errors: Array<{ pass: string; error: string }>;
  cancelled: boolean;
}

export interface CompressedScene {
  id: string;
  position: number;
  opening: string; // First 200 words
  closing: string; // Last 200 words
  summary: string; // AI-generated 150-word summary
  
  metadata: {
    wordCount: number;
    characters: string[];
    locations: string[];
    emotionalTone: string;
    tensionLevel: number; // 1-10
  };
}

export interface DiffSegment {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  startIndex: number;
  endIndex: number;
  reason?: string;
  relatedIssueId?: string;
}

// Scene Consultation System Types
export interface ConsultationContext {
  selectedScenes: Scene[];
  continuityAnalyses: ContinuityAnalysis[];
  readerKnowledge: ReaderKnowledge;
  globalCoherenceAnalysis?: GlobalCoherenceAnalysis;
  rewriteHistory?: RewriteVersion[];
}

export interface ConsultationQuery {
  question: string;
  selectedSceneIds: string[];
  includeContext: {
    continuityIssues: boolean;
    readerKnowledge: boolean;
    globalCoherence: boolean;
    rewriteHistory: boolean;
  };
  sessionId?: string;
}

export interface ConsultationResponse {
  answer: string;
  confidence: number; // 0.0-1.0
  referencedIssues: ContinuityIssue[];
  referencedScenes: string[];
  timestamp: number;
  modelUsed: string;
  sessionId: string;
}

export interface ConsultationSession {
  id: string;
  startTime: number;
  lastActivity: number;
  conversationHistory: Array<{
    query: ConsultationQuery;
    response: ConsultationResponse;
    timestamp: number;
  }>;
  isActive: boolean;
}

export interface ConsultationSettings {
  preferredModel?: string;
  includeGlobalCoherenceByDefault: boolean;
  includeContinuityByDefault: boolean;
  includeRewriteHistoryByDefault: boolean;
  maxSessionDuration: number; // minutes
  maxConversationHistory: number; // number of exchanges to keep
}

