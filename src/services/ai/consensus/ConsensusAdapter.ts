import type { Scene, ContinuityIssue } from '../../../shared/types';
import type { AnalysisRequest } from '../types';
import AIServiceManager from '../AIServiceManager';
import { ValidationPipeline } from '../validation/ValidationPipeline';

// Local mapping helpers (keep tiny and self-contained)
function mapContinuityTypeToSchema(t: ContinuityIssue['type']): 'pronoun_reference' | 'timeline' | 'character_knowledge' | 'other' {
  switch (t) {
    case 'pronoun': return 'pronoun_reference';
    case 'timeline': return 'timeline';
    case 'character': return 'character_knowledge';
    default: return 'other';
  }
}

function mapSchemaTypeToContinuity(t: any): ContinuityIssue['type'] {
  const s = String(t ?? '').toLowerCase();
  if (s === 'pronoun_reference') return 'pronoun';
  if (s === 'timeline') return 'timeline';
  if (s === 'character_knowledge') return 'character';
  // Prefer plot/context over engagement for generic "other"
  return 'plot';
}

function mapContinuitySeverityToSchema(s: ContinuityIssue['severity']): 'low' | 'medium' | 'high' | 'critical' {
  switch (s) {
    case 'must-fix': return 'high';
    case 'should-fix': return 'medium';
    case 'consider': return 'low';
  }
}

function mapSchemaSeverityToContinuity(s: any): ContinuityIssue['severity'] {
  const v = String(s ?? '').toLowerCase();
  if (v === 'critical' || v === 'high') return 'must-fix';
  if (v === 'medium') return 'should-fix';
  return 'consider';
}

function toPipelineIssues(issues: readonly ContinuityIssue[]) {
  return (issues ?? []).map((it) => ({
    type: mapContinuityTypeToSchema(it.type),
    severity: mapContinuitySeverityToSchema(it.severity),
    span: Array.isArray(it.textSpan) && it.textSpan.length === 2
      ? { start_index: it.textSpan[0], end_index: it.textSpan[1] }
      : null,
    explanation: String(it.description ?? '').trim() || 'Issue detected',
    evidence: [],
    suggested_fix: String(it.suggestedFix ?? ''),
    confidence: undefined as number | undefined,
  }));
}

function fromPipelineIssues(pIssues: any[]): ContinuityIssue[] {
  const out: ContinuityIssue[] = [];
  for (const it of pIssues ?? []) {
    const start = it?.span?.start_index;
    const end = it?.span?.end_index;
    const hasSpan = Number.isFinite(start) && Number.isFinite(end) && (end as number) >= (start as number);
    out.push({
      type: mapSchemaTypeToContinuity(it?.type),
      severity: mapSchemaSeverityToContinuity(it?.severity),
      description: String(it?.explanation ?? it?.suggested_fix ?? 'Issue detected'),
      textSpan: hasSpan ? [start, end] as [number, number] : [0, 1],
      suggestedFix: it?.suggested_fix ? String(it.suggested_fix) : undefined,
    });
  }
  return out;
}

// Default small candidate set (local-only; do not import provider registries)
const DEFAULT_CANDIDATES = ['gpt-5', 'claude-sonnet-4'];

export type ExtraFlags = { complex?: boolean; critical?: boolean };

export function enrichAnalysisRequest(
  req: AnalysisRequest & Record<string, any>,
  extras: {
    scene: Scene;
    detectorType: string; // stable taskType label (pronoun, timeline, character, plot, engagement, continuity_rewrite, etc.)
    flags?: ExtraFlags;
  }
): AnalysisRequest & Record<string, any> {
  const newPosition =
    typeof (extras.scene as any)?.position === 'number'
      ? (extras.scene as any).position
      : typeof (extras.scene as any)?.index === 'number'
      ? (extras.scene as any).index
      : 0;

  return Object.assign(req as any, {
    // Stable routing/task labels (kept local; manager tolerates extra props)
    taskType: extras.detectorType,
    detector: extras.detectorType,
    // Flags for heuristics/consensus selection (local only)
    flags: { ...(req as any)?.flags, ...(extras.flags ?? {}) },
    // Local meta (never part of PromptCache identity)
    sceneText: String(extras.scene?.text ?? ''),
    newPosition,
  });
}

/**
 * Run continuity analysis with optional consensus for critical/high-stakes cases.
 * - Preserves PromptCache identity by leaving key fields unchanged.
 * - Injects __modelId into the req for each run so tests can assert distinct candidates.
 * - Returns an object with { issues } compatible with existing mapping utilities.
 */
export async function runAnalysisWithOptionalConsensus(
  aiManager: AIServiceManager,
  req: AnalysisRequest & Record<string, any>,
  opts: {
    critical?: boolean;
    candidates?: string[];
    consensusCount?: number;
    acceptThreshold?: number;
    humanReviewThreshold?: number;
    maxModels?: number;
  } = {}
): Promise<{ issues: ContinuityIssue[] }> {
  const critical = !!opts.critical;
  if (!critical) {
    const resp = await aiManager.analyzeContinuity(req);
    return { issues: resp.issues ?? [] };
  }

  const candidates = (opts.candidates && opts.candidates.length > 0) ? Array.from(new Set(opts.candidates)) : DEFAULT_CANDIDATES.slice(0, 2);

  const pipeline = new ValidationPipeline(
    async (r, { modelId } = {}) => {
      // Attach model id onto the request (local-only, tolerated by manager)
      const r2 = { ...(r as any), __modelId: modelId };
      const single = await aiManager.analyzeContinuity(r2 as any);
      // Convert manager result issues (ContinuityIssue[]) to pipeline schema
      const data = {
        issues: toPipelineIssues(single.issues ?? []),
        summary: '',
        confidence: typeof single?.metadata?.confidence === 'number' ? single.metadata.confidence : 0,
      };
      return { data, modelId, latencyMs: typeof single?.metadata?.durationMs === 'number' ? single.metadata.durationMs : undefined };
    },
    {
      defaultConsensusCount: opts.consensusCount ?? 2,
      acceptThreshold: typeof opts.acceptThreshold === 'number' ? opts.acceptThreshold : 0.5,
      humanReviewThreshold: typeof opts.humanReviewThreshold === 'number' ? opts.humanReviewThreshold : 0.9,
      maxModels: typeof opts.maxModels === 'number' ? opts.maxModels : 2,
    }
  );

  const { data } = await pipeline.runConsensus(req, {
    candidates,
    consensusCount: opts.consensusCount ?? 2,
    acceptThreshold: typeof opts.acceptThreshold === 'number' ? opts.acceptThreshold : 0.5,
    humanReviewThreshold: typeof opts.humanReviewThreshold === 'number' ? opts.humanReviewThreshold : 0.9,
    maxModels: typeof opts.maxModels === 'number' ? opts.maxModels : 2,
  });

  return { issues: fromPipelineIssues((data as any)?.issues ?? []) };
}

/**
 * Specialized minimal adapter for rewrite flows:
 * - For consensus: runs two model attempts and treats the returned "rewrite text" as the pipeline summary.
 * - After consensus, uses merged summary as the chosen rewrite text.
 * - For single run: returns the original manager result.
 */
export async function runRewriteWithOptionalConsensus(
  aiManager: AIServiceManager,
  req: AnalysisRequest & Record<string, any>,
  opts: {
    critical?: boolean;
    candidates?: string[];
    consensusCount?: number;
    acceptThreshold?: number;
    humanReviewThreshold?: number;
    maxModels?: number;
  } = {}
): Promise<any> {
  const critical = !!opts.critical;
  if (!critical) {
    return aiManager.analyzeContinuity(req);
  }

  const candidates = (opts.candidates && opts.candidates.length > 0) ? Array.from(new Set(opts.candidates)) : DEFAULT_CANDIDATES.slice(0, 2);

  const pipeline = new ValidationPipeline(
    async (r, { modelId } = {}) => {
      const r2 = { ...(r as any), __modelId: modelId };
      const single = await aiManager.analyzeContinuity(r2 as any);
      // Extract rewrite text from tolerant locations
      const rewriteText =
        (single as any)?.rewrittenText ??
        (single as any)?.content?.[0]?.text ??
        (single as any)?.text ??
        '';
      const data = {
        issues: [],      // rewrite consensus reconciles on "summary" only
        summary: String(rewriteText ?? ''),
        confidence: typeof (single as any)?.metadata?.confidence === 'number' ? (single as any).metadata.confidence : 0.5,
      };
      return { data, modelId };
    },
    {
      defaultConsensusCount: opts.consensusCount ?? 2,
      acceptThreshold: typeof opts.acceptThreshold === 'number' ? opts.acceptThreshold : 0.5,
      humanReviewThreshold: typeof opts.humanReviewThreshold === 'number' ? opts.humanReviewThreshold : 0.9,
      maxModels: typeof opts.maxModels === 'number' ? opts.maxModels : 2,
    }
  );

  const { data } = await pipeline.runConsensus(req, {
    candidates,
    consensusCount: opts.consensusCount ?? 2,
    acceptThreshold: typeof opts.acceptThreshold === 'number' ? opts.acceptThreshold : 0.5,
    humanReviewThreshold: typeof opts.humanReviewThreshold === 'number' ? opts.humanReviewThreshold : 0.9,
    maxModels: typeof opts.maxModels === 'number' ? opts.maxModels : 2,
  });

  // Return a shape consumable by SceneRewriter.parseRewriteResponse
  return { text: String((data as any)?.summary ?? '') };
}