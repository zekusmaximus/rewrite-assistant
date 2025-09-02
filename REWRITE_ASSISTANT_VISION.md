# REWRITE ASSISTANT VISION - Optimized Implementation Guide

## 🎯 SINGLE OVERRIDING GOAL

**Build a desktop application that helps authors rewrite scenes after manually reordering them in their manuscript, using AI to identify what needs fixing and generate the rewrites.**

This is NOT about finding the best opening. This is about REWRITING scenes for their NEW positions after the author has ALRE-----

## 🚀 ## 🚀 FIRST## 🚀 FIRST DEVELOPMENT TASK

Build ONLY this:

1. Electron app that loads a text file
1. Splits it into scenes (by "Chapter" or "Scene" markers, with fallback to "\n\n" or user-defined)
1. Shows scenes in a draggable list
1. Allows reordering via drag-and-drop
1. Shows the selected scene's text
1. Saves the new order

Nothing else. No analysis. No AI. No scoring. Just reordering. TASK

Build ONLY this:

1. Electron app that loads a text file
1. Splits it into scenes (by "Chapter" or "Scene" markers, with fallback to "\n\n" or user-defined)
1. Shows scenes in a draggable list
1. Allows reordering via drag-and-drop
1. Shows the selected scene's text
1. Saves the new order

Nothing else. No analysis. No AI. No scoring. Just reordering.PMENT TASK

Build ONLY this:

1. Electron app that loads a text file
1. Splits it into scenes (by "Chapter" or "Scene" markers, with fallback to "\n\n" or user-defined)
1. Shows scenes in a draggable list
1. Allows reordering via drag-and-drop
1. Shows the selected scene's text
1. Saves the new order

Nothing else. No analysis. No AI. No scoring. Just reordering. the order. The application is designed for a single draft manuscript loaded from a .txt file.

-----

## ⚠️ CRITICAL: DO NOT BUILD THESE

### ❌ FORBIDDEN FEATURES (Will Cause Scope Drift)

1. **Opening discovery/selection** - User already knows their opening
1. **Candidate generation** - No automated suggestions needed
1. **Scene scoring/ranking** - Not about comparing options
1. **Best opening analysis** - Order is already decided
1. **Optimization algorithms** - Human has chosen the sequence
1. **Market appeal scoring** - Not the problem we’re solving (use issue-based engagement adjustments instead for retention)
1. **Reader retention prediction** - Outside our scope (frame as fixable issues, not predictions)

### ❌ FORBIDDEN TERMINOLOGY (Leads to Confusion)

- “Opening Lab” → Use “Rewrite Workbench”
- “Candidates” → Use “Selected Scenes”
- “Best opening” → Use “New sequence”
- “Optimization” → Use “Adaptation”
- “Score” → Use “Issues” or “Changes needed”

-----

## ✅ WHAT WE ARE BUILDING

### Core Workflow (In Order)

1. **LOAD** - User loads their manuscript from a .txt file
1. **VIEW** - User sees all scenes in current order
1. **REORDER** - User drags scenes to new positions
1. **ANALYZE** - System identifies what breaks, including continuity and optional engagement issues for early scenes
1. **REWRITE** - AI generates scene rewrites for new positions, addressing identified issues
1. **REVIEW** - User reviews and edits AI suggestions with diff views
1. **APPLY** - User applies accepted rewrites
1. **EXPORT** - User exports reordered, rewritten manuscript

### The Three Core Features

#### 1. Scene Reorderer

```typescript
interface SceneReorderer {
  // Visual timeline of all scenes
  currentOrder: Scene[];
  
  // Drag and drop to reorder
  reorder(fromIndex: number, toIndex: number): void;
  
  // Show scene details on hover/click
  scenePreview: SceneContent;
  
  // Track which scenes have moved
  movedScenes: Set<SceneId>;
  
  // Save/load different orderings
  savedOrders: SceneOrder[];
}
```

#### 2. Continuity Analyzer

```typescript
interface ContinuityAnalyzer {
  // What breaks when scene X moves to position Y
  analyzeMove(scene: Scene, oldPos: number, newPos: number): {
    // Concrete issues that need fixing
    pronounProblems: PronounIssue[];      // "She" with no antecedent
    missingContext: MissingContext[];     // Reader doesn't know X yet
    timelineIssues: TimelineConflict[];   // "Next day" makes no sense
    characterIntros: CharacterIssue[];    // Character appears before introduction
    plotReferences: PlotReference[];      // References events that haven't happened
    engagementIssues?: EngagementIssue[]; // Optional: Weak hooks or pacing in early scenes (e.g., first chapters for retention)
  };
  
  // NO scoring, NO optimization, just concrete problems
}
```

#### 3. Scene Rewriter

```typescript
interface SceneRewriter {
  // Generate rewrite for new position
  rewriteForPosition(
    scene: Scene,
    newPosition: number,
    previousScenes: Scene[],  // What reader has seen (reader context)
    issues: ContinuityIssue[]  // What needs fixing, including engagement
  ): Promise<{
    rewrittenText: string;
    changes: Change[];  // What was modified and why
    preservedElements: string[];  // What stayed the same
  }>;
  
  // NO candidate generation, NO comparisons, just rewriting
}
```

-----

## 🛠️ TECHNICAL STACK (STRICT)

### Platform: Electron (Windows)

```json
{
  "why": "Best for text-heavy desktop apps with rich editing needs on Windows",
  "not": "Web (file handling issues), other platforms (not required)"
}
```

### Core Technologies

```yaml
Runtime: Electron 32+  # Updated for latest stable as of 2025
Language: TypeScript 5+ (strict mode)
Framework: React 18
State: Zustand (simple, no Redux)
Editor: ProseMirror or Lexical (NOT CodeMirror)
Styling: Tailwind CSS
Database: SQLite3 via better-sqlite3
Search: MiniSearch (client-side, no Tantivy)
Drag-Drop: @atlaskit/pragmatic-drag-and-drop
AI Integration: Generic AI service integration (configurable)
Testing: Vitest
Builder: Electron Forge (Windows-focused)
NLP: compromise (lightweight for metadata extraction like characters/time markers)
```

### File Structure (Enforce This)

```
/src
  /main           # Electron main process
    index.ts      # Entry point
    handlers.ts   # IPC handlers
    
  /renderer       # React app
    /features
      /reorder    # Drag-drop reordering ONLY
        SceneList.tsx
        SceneReorderer.tsx
        
      /analyze    # Continuity analysis ONLY  
        ContinuityAnalyzer.ts
        IssueDetector.ts
        
      /rewrite    # AI rewriting ONLY
        SceneRewriter.ts
        RewritePanel.tsx
        
    /components   # Shared UI components
    /stores       # Zustand stores
    /types        # TypeScript types
    
  /shared         # Shared between main/renderer
    types.ts
    constants.ts
```

-----

## 📐 DATA MODEL (IMMUTABLE)

### Core Types

```typescript
// A scene is a unit of narrative
interface Scene {
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
interface ContinuityIssue {
  type: 'pronoun' | 'timeline' | 'character' | 'plot' | 'context' | 'engagement';  // Extended for retention
  severity: 'must-fix' | 'should-fix' | 'consider';
  description: string;
  textSpan: [start: number, end: number];
  suggestedFix?: string;
}

// NO "Candidate" type
// NO "Score" type  
// NO "Optimization" type
```

-----

## 🚫 STRICT PROHIBITIONS

### Code Review Blockers

Any PR with these will be rejected:

1. Variables named `candidate`, `score`, `optimize`, `best`
1. Functions that rank, score, or compare scenes
1. Automated scene selection logic
1. Any “Opening Lab” terminology
1. Multiple “options” for the same scene position
1. Optimization algorithms of any kind

### Architecture Violations

These indicate scope drift:

1. More than one rewrite per scene per position
1. Comparing different orderings automatically
1. Suggesting “better” arrangements
1. Market/reader analysis features (unless framed as issue-based engagement fixes)
1. Success prediction metrics

-----

## ✅ IMPLEMENTATION PRIORITIES

### Phase 1: Core Reordering (Weeks 1-1.5)

```typescript
// ONLY focus on:
- Load manuscript from .txt (split scenes on markers like "### SCENE BREAK" or "\n\n")
- Parse into scenes
- Display scene list
- Drag to reorder
- Save new order
// NO analysis yet
```

### Phase 2: Continuity Analysis (Weeks 1.5-2.5)

```typescript
// ONLY focus on:
- Identify pronouns without antecedents
- Find timeline conflicts
- Detect character appearance issues
- List missing context
- Optional: Engagement issues for early scenes (e.g., weak hooks for retention)
// NO rewriting yet
```

### Phase 3: AI Rewriting (Weeks 2.5-3.5)

```typescript
// ONLY focus on:
- Generate rewrite for ONE scene, addressing issues including engagement
- Show changes made
- Allow user editing
- Apply approved rewrites
// NO automation
```

### Phase 4: Polish (Weeks 3.5-5)

```typescript
// ONLY focus on:
- Export rewritten manuscript
- Undo/redo support
- Performance optimization (e.g., indexing for large .txt)
- Error handling
- Integration testing buffer
```

-----

## 📋 SUCCESS METRICS

### What Success Looks Like

1. ✅ User can reorder scenes in < 5 seconds
1. ✅ Continuity issues identified in < 2 seconds
1. ✅ AI generates rewrite in < 30 seconds
1. ✅ User can review and edit rewrite with diff views
1. ✅ Export produces clean manuscript

### What Success Does NOT Look Like

1. ❌ “Found the optimal opening”
1. ❌ “Improved market appeal by X%”
1. ❌ “Generated 5 candidates”
1. ❌ “Best score achieved”
1. ❌ “Reader engagement predicted”

-----

## 🎨 UI/UX PRINCIPLES

### Layout

```
+------------------+------------------+
|                  |                  |
|   Scene List     |   Scene Content  |
|   (Draggable)    |    (Selected)    |
|                  |                  |
+------------------+------------------+
|  Issues Found    |  Rewrite Panel   |
|                  |  (With Diff View)|
+------------------+------------------+
```

### Interactions

- **Drag**: Reorder scenes
- **Click**: Select scene to view/edit (highlight first few for retention focus)
- **Generate**: Create rewrite for selected scene
- **Apply**: Accept rewrite
- **Revert**: Restore original

### NO These UI Elements

- ❌ Score displays
- ❌ Ranking tables
- ❌ Comparison grids
- ❌ “Best” indicators
- ❌ Optimization controls

-----

## 🔧 DEVELOPMENT GUIDELINES

### Every File Must

1. Have a single, clear purpose
1. Use terminology from this document
1. Avoid optimization/scoring concepts
1. Focus on rewriting, not selection

### Every Commit Must

1. Reference this vision document
1. Explain how it serves rewriting
1. Not introduce selection/scoring features
1. Use correct terminology

### Code Reviews Must Check

1. No scope drift toward “opening selection”
1. No optimization algorithms
1. No scoring systems
1. Correct terminology used
1. Focused on rewriting (allow issue-based engagement extensions)

-----

## 📝 EXAMPLE: CORRECT IMPLEMENTATION

```typescript
// ✅ CORRECT: Focused on rewriting
class SceneRewriter {
  async rewriteSceneForNewPosition(
    scene: Scene,
    newPosition: number,
    previousScenes: Scene[]
  ): Promise<RewriteResult> {
    // Identify what reader knows at this point
    const readerKnowledge = this.extractReaderKnowledge(previousScenes);
    
    // Find issues with scene at new position
    const issues = this.findContinuityIssues(scene, readerKnowledge);
    
    // Generate rewrite to fix issues
    const rewrite = await this.generateRewrite(scene, issues, readerKnowledge);
    
    return {
      rewrittenText: rewrite,
      issuesFixed: issues,
      changesMode: this.diffChanges(scene.text, rewrite)
    };
  }
}
```

```typescript
// ❌ WRONG: Drifting toward selection
class OpeningOptimizer {
  async findBestOpening(scenes: Scene[]): Promise<Candidate[]> {
    // NO! This is not what we're building
    const candidates = this.generateCandidates(scenes);
    const scored = this.scoreOptions(candidates);
    return this.rankByScore(scored);
  }
}
```

-----

## 🚀 FIRST TASK FOR CLAUDE CODE

Build ONLY this:

1. Electron app that loads a text file
1. Splits it into scenes (by “Chapter” or “Scene” markers, with fallback to "\n\n" or user-defined)
1. Shows scenes in a draggable list
1. Allows reordering via drag-and-drop
1. Shows the selected scene’s text
1. Saves the new order

Nothing else. No analysis. No AI. No scoring. Just reordering.

-----

## ⚠️ FINAL WARNING

This document is the SINGLE SOURCE OF TRUTH. Any deviation toward “opening selection”, “optimization”, or “candidate generation” is SCOPE DRIFT and must be rejected.

We are building a REWRITE ASSISTANT, not an OPENING ANALYZER.

The user has ALREADY DECIDED their scene order. We HELP THEM REWRITE for that order.

That is all.

-----

## 🔮 FUTURE EXTENSIONS (NON-BINDING)

These are optional post-MVP ideas, not part of core scope:

- AI-driven feedback: Extend engagement issues to focus on retention for first pages/chapters (e.g., "Enhance hook for better reader engagement" as a fixable issue)
- Versioning for multiple rewrites per scene
- Advanced scene splitting options for complex .txt files