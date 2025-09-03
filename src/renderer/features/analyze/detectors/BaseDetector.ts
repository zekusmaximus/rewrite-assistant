import type { Scene, ContinuityIssue } from '../../../../shared/types';
import AIServiceManager from '../../../../services/ai/AIServiceManager';

/**
 * Local detection result from a specific detector before optional AI enrichment.
 */
export interface LocalDetectionResult<T = unknown> {
  issues: ContinuityIssue[];
  requiresAI: boolean;
  candidates: readonly T[];
  stats?: Record<string, number>;
}

/**
 * Abstract base class for all continuity detectors.
 * Handles orchestration between local (rule/NLP) pass and optional AI pass.
 */
export default abstract class BaseDetector<TCandidate = unknown> {
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
    aiManager: AIServiceManager
  ): Promise<ContinuityIssue[]> {
    try {
      const local = await this.localDetection(scene, previousScenes, aiManager);
      const baseIssues = Array.isArray(local.issues) ? local.issues : [];
      if (!local.requiresAI) {
        console.debug(`[${this.constructor.name}] Local-only detection complete: ${baseIssues.length} issue(s).`);
        return baseIssues;
      }

      try {
        const aiIssues = await this.aiDetection(scene, previousScenes, aiManager, local.candidates ?? []);
        const merged = this.mergeResults(baseIssues, aiIssues);
        console.debug(
          `[${this.constructor.name}] AI-enriched detection complete: local=${baseIssues.length}, ai=${aiIssues.length}, merged=${merged.length}`
        );
        return merged;
      } catch (aiErr) {
        console.debug(`[${this.constructor.name}] AI enrichment failed; returning local issues only.`, aiErr);
        return baseIssues;
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
  ): Promise<LocalDetectionResult<TCandidate>>;

  /**
   * Optional AI enrichment step, only called if localDetection.requiresAI === true.
   * May consult the AIServiceManager to analyze candidates and produce additional issues.
   */
  protected abstract aiDetection(
    scene: Scene,
    previousScenes: readonly Scene[],
    aiManager: AIServiceManager,
    candidates: readonly TCandidate[]
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