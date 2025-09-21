import type { CompressedScene } from '../../../shared/types';

/**
 * Model-agnostic prompt builders for global coherence analysis.
 * Each returns a string that will be formatted by the provider.
 * Focus on actionable issues that affect scene-level continuity.
 */

/**
 * Build transition analysis prompt for adjacent scenes (Pass 1)
 * Used by TransitionAnalyzer - evaluates flow between two scenes
 */
export function buildTransitionPrompt(
  sceneA: CompressedScene,
  sceneB: CompressedScene
): string {
  // Use XML structure that works across all models
  return `<analysis_task>
<role>narrative_transition_specialist</role>
<instructions>Evaluate the transition quality between two adjacent scenes. Focus on elements that would jar a reader out of the story.</instructions>

<scene_a position="${sceneA.position}">
  <summary>${sceneA.summary}</summary>
  <ending_text>${sceneA.closing}</ending_text>
  <metadata>
    <characters>${sceneA.metadata.characters.join(', ') || 'none'}</characters>
    <locations>${sceneA.metadata.locations.join(', ') || 'unspecified'}</locations>
    <emotional_tone>${sceneA.metadata.emotionalTone}</emotional_tone>
    <tension_level>${sceneA.metadata.tensionLevel}/10</tension_level>
  </metadata>
</scene_a>

<scene_b position="${sceneB.position}">
  <summary>${sceneB.summary}</summary>
  <opening_text>${sceneB.opening}</opening_text>
  <metadata>
    <characters>${sceneB.metadata.characters.join(', ') || 'none'}</characters>
    <locations>${sceneB.metadata.locations.join(', ') || 'unspecified'}</locations>
    <emotional_tone>${sceneB.metadata.emotionalTone}</emotional_tone>
    <tension_level>${sceneB.metadata.tensionLevel}/10</tension_level>
  </metadata>
</scene_b>

<evaluation_criteria>
- Temporal continuity: Does time flow logically? Are there unexplained time jumps?
- Spatial continuity: Do locations change consistently? Are transitions clear?
- Emotional continuity: Do character emotions evolve naturally?
- Momentum preservation: Does narrative energy carry through appropriately?
- Hook-to-resolution: Does scene B's opening connect to scene A's ending?
</evaluation_criteria>

<output_instructions>
Return ONLY a valid JSON object with this exact structure, no additional text or markdown:
{
  "transitionScore": 0.0 to 1.0,
  "issues": [
    {
      "type": "jarring_pace_change" or "emotional_whiplash" or "time_gap" or "location_jump" or "unresolved_tension",
      "severity": "must-fix" or "should-fix" or "consider",
      "description": "Specific description of the issue",
      "suggestion": "Concrete fix to smooth the transition"
    }
  ],
  "strengths": ["What works well in this transition"],
  "flags": {
    "needsSceneBreak": true/false,
    "needsTransitionScene": true/false,
    "chapterBoundaryCandidate": true/false
  }
}
</output_instructions>
</analysis_task>`;
}

/**
 * Build sequence flow analysis prompt (Pass 2)
 * Used by SequenceAnalyzer - evaluates narrative flow across 3-5 scenes
 */
export function buildSequencePrompt(
  scenes: CompressedScene[],
  manuscriptGenre?: string
): string {
  const sceneBlocks = scenes.map((scene, idx) => `
  <scene id="${scene.id}" position="${scene.position}" sequence_number="${idx + 1}">
    <summary>${scene.summary}</summary>
    <characters>${scene.metadata.characters.join(', ') || 'none'}</characters>
    <tension>${scene.metadata.tensionLevel}/10</tension>
    <tone>${scene.metadata.emotionalTone}</tone>
  </scene>`).join('');

  return `<analysis_task>
<role>narrative_flow_analyst</role>
<manuscript_genre>${manuscriptGenre || 'fiction'}</manuscript_genre>
<instructions>Analyze narrative coherence across this sequence of ${scenes.length} consecutive scenes.</instructions>

<scene_sequence>${sceneBlocks}
</scene_sequence>

<analysis_dimensions>
- CAUSALITY: Events should follow cause-and-effect relationships
- ESCALATION: Tension should build, release, or maintain appropriately  
- INFORMATION_REVEAL: Plot information should be revealed at proper pace
- CHARACTER_AGENCY: Characters should actively drive the plot forward
- THEMATIC_CONSISTENCY: Themes and motifs should develop coherently
</analysis_dimensions>

<output_instructions>
Return ONLY a valid JSON object, no markdown or additional text:
{
  "flowScore": 0.0 to 1.0,
  "flowIssues": [
    {
      "pattern": "broken_causality" or "passive_sequence" or "info_dump" or "info_gap",
      "description": "Specific description",
      "severity": "must-fix" or "should-fix" or "consider",
      "affectedScenes": ["scene IDs that have this issue"]
    }
  ],
  "pacingIssues": [
    {
      "pattern": "too_slow" or "too_fast" or "inconsistent",
      "description": "Specific description",
      "tensionDelta": numeric change in tension,
      "affectedScenes": ["scene IDs"]
    }
  ],
  "thematicIssues": [
    {
      "theme": "Name of theme/motif",
      "description": "How the theme is broken",
      "lastSeenScene": "scene ID where theme last appeared",
      "brokenAtScene": "scene ID where discontinuity occurs"
    }
  ],
  "causalityChain": ["event1->event2", "event2->event3"],
  "tensionCurve": [array of tension values],
  "suggestions": ["Specific fixes for identified issues"]
}
</output_instructions>
</analysis_task>`;
}

/**
 * Build chapter coherence analysis prompt (Pass 3)
 * Evaluates if scenes within a chapter form a cohesive unit
 */
export function buildChapterPrompt(
  scenes: CompressedScene[],
  chapterNumber: number,
  totalWordCount: number
): string {
  const sceneSummaries = scenes.map((s, idx) => 
    `Scene ${idx + 1}: ${s.summary}`
  ).join('\n');

  return `<analysis_task>
<role>chapter_structure_analyst</role>
<instructions>Evaluate whether these scenes form a cohesive chapter.</instructions>

<chapter_data>
  <number>${chapterNumber}</number>
  <scene_count>${scenes.length}</scene_count>
  <word_count>${totalWordCount}</word_count>
  <opening_hook>${scenes[0]?.opening.slice(0, 150) || 'N/A'}...</opening_hook>
  <closing_line>...${scenes[scenes.length - 1]?.closing.slice(-150) || 'N/A'}</closing_line>
</chapter_data>

<scene_summaries>
${sceneSummaries}
</scene_summaries>

<evaluation_criteria>
- UNITY: Do scenes share common narrative thread or purpose?
- COMPLETENESS: Does chapter feel self-contained yet connected to larger story?
- PACING: Is scene distribution and narrative energy balanced?
- PURPOSE: Does chapter meaningfully advance plot/character/theme?
</evaluation_criteria>

<output_instructions>
Return ONLY valid JSON:
{
  "coherenceScore": 0.0 to 1.0,
  "shouldSplit": true/false,
  "shouldMergeWithNext": true/false,
  "orphanedScenes": ["IDs of scenes that don't belong"],
  "missingElements": ["What's needed for completeness"],
  "pacingIssues": {
    "frontLoaded": true/false,
    "saggyMiddle": true/false,
    "rushedEnding": true/false
  },
  "suggestions": ["Specific improvements"]
}
</output_instructions>
</analysis_task>`;
}

/**
 * Build manuscript arc validation prompt (Pass 4)
 * Analyzes overall story structure and character arcs
 */
export function buildArcPrompt(
  manuscriptSkeleton: {
    acts: Array<{ summary: string; chapterRange: [number, number] }>;
    totalScenes: number;
    mainCharacters: string[];
    primaryTheme?: string;
  }
): string {
  const actDescriptions = manuscriptSkeleton.acts.map((act, idx) => 
    `<act number="${idx + 1}" chapters="${act.chapterRange[0]}-${act.chapterRange[1]}">
    ${act.summary}
  </act>`
  ).join('\n');

  return `<analysis_task>
<role>story_structure_expert</role>
<instructions>Validate the complete manuscript's narrative arc and structural integrity.</instructions>

<manuscript_overview>
  <total_scenes>${manuscriptSkeleton.totalScenes}</total_scenes>
  <main_characters>${manuscriptSkeleton.mainCharacters.join(', ')}</main_characters>
  <primary_theme>${manuscriptSkeleton.primaryTheme || 'unspecified'}</primary_theme>
</manuscript_overview>

<three_act_structure>
${actDescriptions}
</three_act_structure>

<validation_criteria>
- THREE_ACT_BALANCE: Are acts properly proportioned (typically 25%-50%-25%)?
- PROTAGONIST_ARC: Does main character have complete transformation journey?
- ANTAGONIST_PRESENCE: Is there sufficient opposition throughout?
- SUBPLOT_INTEGRATION: Do subplots enhance rather than distract?
- THEME_EXECUTION: Is central theme explored and resolved?
- PROMISE_FULFILLMENT: Does story deliver on opening's promise?
</validation_criteria>

<output_instructions>
Return ONLY valid JSON:
{
  "structuralIntegrity": 0.0 to 1.0,
  "actBalance": [25, 50, 25],
  "characterArcs": {
    "protagonist": {
      "completeness": 0.0 to 1.0,
      "keyMissingElements": ["what's missing"]
    }
  },
  "plotHoles": ["Unresolved plot elements"],
  "pacingCurve": {
    "slowSpots": [{"start": "scene_id", "end": "scene_id", "reason": "why"}],
    "rushedSections": [{"start": "scene_id", "end": "scene_id", "reason": "why"}]
  },
  "thematicCoherence": 0.0 to 1.0,
  "criticalFixes": [
    {
      "issue": "Description",
      "affectedScenes": ["scene_ids"],
      "priority": 1-10,
      "suggestion": "Specific fix"
    }
  ]
}
</output_instructions>
</analysis_task>`;
}

/**
 * Build synthesis prompt (Pass 5)
 * Aggregates and prioritizes all findings
 */
export function buildSynthesisPrompt(
  findings: {
    transitionIssueCount: number;
    flowIssueCount: number;
    pacingIssueCount: number;
    chapterIssueCount: number;
    arcIssues?: string[];
    totalScenes: number;
    movedScenes: number;
  }
): string {
  return `<analysis_task>
<role>manuscript_synthesis_expert</role>
<instructions>Synthesize global coherence findings into prioritized, actionable recommendations.</instructions>

<analysis_summary>
  <total_scenes>${findings.totalScenes}</total_scenes>
  <moved_scenes>${findings.movedScenes}</moved_scenes>
  <transition_issues>${findings.transitionIssueCount}</transition_issues>
  <flow_issues>${findings.flowIssueCount}</flow_issues>
  <pacing_issues>${findings.pacingIssueCount}</pacing_issues>
  <chapter_issues>${findings.chapterIssueCount}</chapter_issues>
  ${findings.arcIssues ? `<arc_issues>${findings.arcIssues.join(', ')}</arc_issues>` : ''}
</analysis_summary>

<synthesis_goals>
- Identify patterns across all issue types
- Determine root causes vs symptoms
- Prioritize by impact on reader experience
- Find issue clusters requiring coordinated fixes
- Recommend minimal changes for maximum improvement
</synthesis_goals>

<output_instructions>
Return ONLY valid JSON:
{
  "overallCoherenceScore": 0.0 to 1.0,
  "topPriorities": [
    {
      "issuePattern": "Description of pattern",
      "affectedSceneCount": number,
      "impact": "high" or "medium" or "low",
      "rootCause": "Underlying cause",
      "recommendedFix": "Specific action"
    }
  ],
  "issuesClusters": [
    {
      "location": "Scenes X-Y",
      "issueTypes": ["transition", "pacing", "flow"],
      "unifiedSolution": "Single fix addressing multiple issues"
    }
  ],
  "reorderingAssessment": {
    "benefitsAchieved": ["What improved"],
    "unintendedConsequences": ["What broke"],
    "netBenefit": "positive" or "neutral" or "negative"
  },
  "actionPlan": [
    "Step 1: Fix critical transitions in scenes X-Y",
    "Step 2: Address pacing in middle section",
    "Step 3: Strengthen chapter endings"
  ]
}
</output_instructions>
</analysis_task>`;
}

/**
 * Create a minimal prompt for quick analysis
 */
export function buildQuickTransitionPrompt(
  sceneAEnding: string,
  sceneBOpening: string
): string {
  return `Compare these scene boundaries and rate transition smoothness (0-1):
Scene A ends: "${sceneAEnding}"
Scene B begins: "${sceneBOpening}"

Return JSON only:
{"score": 0.0-1.0, "issue": "description or null"}`;
}