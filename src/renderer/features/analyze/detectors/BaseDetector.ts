import type { Scene, ContinuityIssue, IssueSeverity, GlobalCoherenceAnalysis, ScenePairAnalysis } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import KeyGate from '../../../../services/ai/KeyGate';
import { AIServiceError, ServiceUnavailableError } from '../../../../services/ai/errors/AIServiceErrors';

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

  private keyGate = new KeyGate();

  /**
   * AI-only detection path with centralized KeyGate validation.
   * No local fallbacks. Structured error propagation.
   */
  public async detect(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    globalContext?: GlobalCoherenceAnalysis
  ): Promise<ContinuityIssue[]> {
    // Validate provider key before any processing
    await this.keyGate.requireKey('claude', { validate: true });

    try {
      // Only AI detection path
      const aiIssues = await this.aiDetection(scene, previousScenes, aiManager, []);
      const enrichedIssues = globalContext
        ? this.enrichWithGlobalContext(aiIssues, scene, globalContext)
        : aiIssues;

      console.debug(`[${this.constructor.name}] AI-only detection complete: ${enrichedIssues.length} issue(s).`);
      return enrichedIssues;
    } catch (error) {
      // No fallbacks - propagate structured AI errors
      if (error instanceof AIServiceError) {
        throw error;
      }
      throw new ServiceUnavailableError(this.detectorType, 0);
    }
  }

  /**
   * AI detection step. Implementations must call providers via AIServiceManager and return issues.
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