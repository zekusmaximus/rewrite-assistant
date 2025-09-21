import type { Scene, ContinuityIssue, IssueSeverity, GlobalCoherenceAnalysis, ScenePairAnalysis } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';

/**
 * Local detection result from a specific detector before optional AI enrichment.
 */
export interface LocalDetectionResult<T = unknown> {
  issues: ContinuityIssue[];
  requiresAI: boolean;
  targets: readonly T[];
  stats?: Record<string, number>;
}

/**
 * Abstract base class for all continuity detectors.
 * Handles orchestration between local (rule/NLP) pass and optional AI pass.
 */
export default abstract class BaseDetector<TTarget = unknown> {
  public abstract readonly detectorType:
    | 'pronoun'
    | 'timeline'
    | 'character'
    | 'plot'
    | 'engagement';

  /**
   * Run detection for a scene, optionally enriching with AI if requested by local pass.
   * Robust to AI failures: returns at least local issues.
   */
  public async detect(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    globalContext?: GlobalCoherenceAnalysis
  ): Promise<ContinuityIssue[]> {
    try {
      const local = await this.localDetection(scene, previousScenes, aiManager);
      const baseIssues = Array.isArray(local.issues) ? local.issues : [];

      const enrichedIssues = globalContext
        ? this.enrichWithGlobalContext(baseIssues, scene, globalContext)
        : baseIssues;

      if (!local.requiresAI) {
        console.debug(
          `[${this.constructor.name}] Local-only detection complete: ${enrichedIssues.length} issue(s).`
        );
        return enrichedIssues;
      }

      try {
        const aiIssues = await this.aiDetection(scene, previousScenes, aiManager, local.targets ?? []);
        const merged = this.mergeResults(enrichedIssues, aiIssues);
        console.debug(
          `[${this.constructor.name}] AI-enriched detection complete: local=${enrichedIssues.length}, ai=${aiIssues.length}, merged=${merged.length}`
        );
        return merged;
      } catch (aiErr) {
        console.debug(`[${this.constructor.name}] AI enrichment failed; returning local issues only.`, aiErr);
        return enrichedIssues;
      }
    } catch (err) {
      console.debug(`[${this.constructor.name}] Local detection failed; returning empty list.`, err);
      return [];
    }
  }

  /**
   * Implement local (non-AI) pass using heuristics, regex, or lightweight NLP.
   * Should be fast and side-effect-free.
   */
  protected abstract localDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager
  ): Promise<LocalDetectionResult<TTarget>>;

  /**
   * Optional AI enrichment step, only called if localDetection.requiresAI === true.
   * May consult the AIServiceManager to analyze detection targets and produce additional issues.
   */
  protected abstract aiDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    targets: readonly TTarget[]
  ): Promise<ContinuityIssue[]>;

  /**
   * Merge and de-duplicate issues. Default strategy: concat and de-dupe by (type, start, end, description).
   */
  protected mergeResults(baseIssues: readonly ContinuityIssue[], aiIssues: readonly ContinuityIssue[]): ContinuityIssue[] {
    const out: ContinuityIssue[] = [];
    const seen = new Set<string>();

    const add = (it: ContinuityIssue): void => {
      const [start, end] = it.textSpan ?? [NaN, NaN];
      const key = `${it.type}|${start}|${end}|${it.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(it);
      }
    };

    for (const i of baseIssues) add(i);
    for (const i of aiIssues) add(i);
    return out;
  }

  /**
   * Enrich issues with global coherence context when available.
   * Adds description suffix, possible severity escalation, and attaches globalContext payload.
   */
  protected enrichWithGlobalContext(
    issues: readonly ContinuityIssue[],
    scene: Scene,
    globalContext: GlobalCoherenceAnalysis
  ): ContinuityIssue[] {
    if (!issues?.length) return issues.slice();

    const before = globalContext.sceneLevel.find(t => t.sceneBId === scene.id);
    const after = globalContext.sceneLevel.find(t => t.sceneAId === scene.id);

    const beforeScore = typeof before?.transitionScore === 'number' ? before!.transitionScore : undefined;
    const afterScore = typeof after?.transitionScore === 'number' ? after!.transitionScore : undefined;

    const minScore = Math.min(
      beforeScore ?? 1,
      afterScore ?? 1
    );

    return issues.map((iss) => {
      const correlated = this.checkGlobalImpact(iss, before, after, globalContext);
      if (!correlated) return iss;

      const parts: string[] = [];
      if (typeof beforeScore === 'number') parts.push(`before=${beforeScore.toFixed(2)}`);
      if (typeof afterScore === 'number') parts.push(`after=${afterScore.toFixed(2)}`);
      parts.push('flow=affected');

      const suffix = ` [Global coherence: ${parts.join(' ')}]`;
      const escalated = this.escalateSeverity(iss.severity as IssueSeverity, minScore);

      return {
        ...iss,
        severity: escalated,
        description: (iss.description ?? '').trim() + suffix,
        globalContext: {
          transitionScoreBefore: beforeScore,
          transitionScoreAfter: afterScore,
          affectsNarrativeFlow: true,
        },
      };
    });
  }

  /**
   * Heuristically determine whether a local issue correlates with global transition/flow problems.
   */
  protected checkGlobalImpact(
    issue: ContinuityIssue,
    transitionBefore?: ScenePairAnalysis,
    transitionAfter?: ScenePairAnalysis,
    globalContext?: GlobalCoherenceAnalysis
  ): boolean {
    const tIssues = [
      ...(transitionBefore?.issues ?? []),
      ...(transitionAfter?.issues ?? []),
    ];

    const tTypes = new Set(tIssues.map(i => i.type));
    const anyDescMentionsCharacter = tIssues.some(i => (i.description ?? '').toLowerCase().includes('character'));

    // Flow-level checks
    const sceneId = (globalContext as any) ? (issue as any).sceneId ?? undefined : undefined; // not all issues include scene id
    const sceneAffectedByFlow = !!globalContext?.flowIssues?.some(f =>
      f.affectedScenes?.some(sid => sid === sceneId)
    );
    const sceneAffectedByPacing = !!globalContext?.pacingProblems?.some(p =>
      p.affectedScenes?.some(sid => sid === sceneId)
    );

    switch (issue.type) {
      case 'pronoun':
        return tTypes.has('jarring_pace_change') || tTypes.has('emotional_whiplash') || sceneAffectedByFlow;
      case 'character':
        return anyDescMentionsCharacter || tTypes.has('unresolved_tension') || sceneAffectedByFlow;
      case 'timeline':
        return tTypes.has('time_gap') || sceneAffectedByFlow;
      case 'plot':
      case 'context':
        return tTypes.has('unresolved_tension') || tTypes.has('location_jump') || sceneAffectedByFlow;
      case 'engagement':
        return tTypes.has('jarring_pace_change') || tTypes.has('emotional_whiplash') || sceneAffectedByPacing;
      default:
        return false;
    }
  }

  /**
   * Escalate severity based on transition score thresholds.
   * Mapping aligned to existing IssueSeverity {'consider'|'should-fix'|'must-fix'}.
   *
   * Rules:
   * - score < 0.3: consider -> should-fix, should-fix -> must-fix, must-fix unchanged
   * - score < 0.5: consider -> should-fix, others unchanged
   * - else: unchanged
   */
  protected escalateSeverity(current: IssueSeverity, transitionScore: number): IssueSeverity {
    const stepUp = (s: IssueSeverity): IssueSeverity =>
      s === 'consider' ? 'should-fix' : s === 'should-fix' ? 'must-fix' : 'must-fix';

    if (transitionScore < 0.3) {
      return stepUp(stepUp(current));
    }
    if (transitionScore < 0.5) {
      return stepUp(current);
    }
    return current;
  }

  /**
   * Lazy, safe loader for compromise NLP. Returns null on failure.
   * Not used yet by default implementations but provided for subclasses.
   */
  protected async safeNLP(text: string): Promise<any | null> {
    try {
      const mod = await import('compromise');
      const nlp = (mod as any).default ?? mod;
      return typeof nlp === 'function' ? nlp(text) : null;
    } catch (err) {
      console.debug(`[${this.constructor.name}] safeNLP failed to load compromise`, err);
      return null;
    }
  }
}