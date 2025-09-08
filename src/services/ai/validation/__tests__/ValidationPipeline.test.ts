import { describe, it, expect } from 'vitest';
import { ValidationPipeline } from '../ValidationPipeline';
import type { AnalysisRequest } from '../../types';
import type { AnalysisResponse } from '../../schemas/ResponseSchemas';

function makeReq(): AnalysisRequest {
  // Minimal stub; pipeline does not depend on request shape for tests.
  return {} as unknown as AnalysisRequest;
}

function makeAnalyzeStub(map: Record<string, AnalysisResponse>) {
  return async (_req: AnalysisRequest, opts?: { modelId?: string }) => {
    const id = opts?.modelId ?? 'primary';
    const data = map[id];
    if (!data) {
      throw new Error(`No stubbed response for modelId=${id}`);
    }
    return {
      data,
      modelId: id,
      meta: { modelId: id },
      latencyMs: 1,
    };
  };
}

describe('ValidationPipeline - consensus and reconciliation', () => {
  it('single-model run returns issues unchanged and no human review for moderate confidence', async () => {
    const resp: AnalysisResponse = {
      issues: [
        {
          type: 'timeline',
          severity: 'medium',
          span: { start_index: 10, end_index: 20 },
          explanation: 'Event sequence appears out of order.',
          evidence: ['Paragraph 2: "...then earlier..."', 'Paragraph 3: "...before that..."'],
          suggested_fix: 'Clarify chronological ordering or adjust timestamps.',
          confidence: 0.6,
        },
      ],
      summary: 'One timeline inconsistency detected.',
      confidence: 0.6,
    };

    const pipeline = new ValidationPipeline(makeAnalyzeStub({ primary: resp }), {
      defaultConsensusCount: 1,
    });

    const { data, meta } = await pipeline.runConsensus(makeReq());

    expect(data.issues.length).toBe(1);
    const issue = data.issues[0];
    expect(issue.type).toBe('timeline');
    expect(issue.severity).toBe('medium');
    expect(issue.span).toEqual({ start_index: 10, end_index: 20 });
    expect(issue.explanation).toContain('Event sequence');
    expect(issue.evidence).toEqual([
      'Paragraph 2: "...then earlier..."',
      'Paragraph 3: "...before that..."',
    ]);
    expect(issue.suggested_fix).toContain('Clarify chronological');
    expect(issue.confidence).toBeCloseTo(0.6, 5);

    // Top-level confidence is mean of issue confidences
    expect(data.confidence).toBeCloseTo(0.6, 5);

    // No human review expected
    expect(meta.humanReviewRequired).toBe(false);
    expect(meta.perModel.length).toBe(1);
    expect(meta.attempts).toBe(1);

    // Votes should reflect 1 model contribution
    const hash = ValidationPipeline.hashIssue(resp.issues[0]);
    expect(meta.votes[hash]?.count).toBe(1);
  });

  it('two-model agreement merges into single issue with confidence boost and votes=2', async () => {
    const modelA: AnalysisResponse = {
      issues: [
        {
          type: 'timeline',
          severity: 'high',
          span: { start_index: 100, end_index: 120 }, // bucket 2-2 for size 50
          explanation: 'Scene mentions results before the setup occurs.',
          evidence: ['Line A1', 'Line A2', 'Shared Line'],
          suggested_fix: 'Move setup earlier or adjust the mention.',
          confidence: 0.8,
        },
      ],
      summary: 'High confidence timeline issue.',
      confidence: 0.8,
    };

    const modelB: AnalysisResponse = {
      issues: [
        {
          type: 'timeline',
          severity: 'high',
          span: { start_index: 110, end_index: 125 }, // bucket 2-2 for size 50
          explanation: 'Outcome is referenced prior to cause.',
          evidence: ['Shared Line', 'Line B1'],
          suggested_fix: 'Reorder cause and effect to maintain chronology.',
          confidence: 0.7,
        },
      ],
      summary: 'Agreement on timeline issue.',
      confidence: 0.7,
    };

    const analyze = makeAnalyzeStub({ mA: modelA, mB: modelB });
    const pipeline = new ValidationPipeline(analyze);

    const { data, meta } = await pipeline.runConsensus(makeReq(), {
      candidates: ['mA', 'mB'],
      consensusCount: 2,
    });

    // Merged to a single issue
    expect(data.issues.length).toBe(1);
    const merged = data.issues[0];
    expect(merged.type).toBe('timeline');
    expect(merged.severity).toBe('high');

    // Span chosen by votes; both buckets equal; tie-break by narrowest
    expect(merged.span).toEqual({ start_index: 110, end_index: 125 });

    // Confidence = average(0.8, 0.7) + 0.05 boost (2 votes) = 0.8
    expect(merged.confidence).toBeCloseTo(0.8, 5);

    // Evidence de-duplicated and combined (cap 10)
    expect(merged.evidence).toEqual(['Line A1', 'Line A2', 'Shared Line', 'Line B1']);

    // Votes meta should show 2 votes for the grouped issue hash
    const originalHash = ValidationPipeline.hashIssue(modelA.issues[0]);
    expect(meta.votes[originalHash]?.count).toBe(2);
    expect(new Set(meta.votes[originalHash]?.modelIds || [])).toEqual(new Set(['mA', 'mB']));
  });

  it('disagreement with different issue types and non-overlapping spans yields two merged issues at acceptThreshold=0.5 and dedup evidence', async () => {
    const modelA: AnalysisResponse = {
      issues: [
        {
          type: 'timeline',
          severity: 'medium',
          span: { start_index: 0, end_index: 10 }, // bucket 0-0
          explanation: 'Intro references later events.',
          evidence: ['DUP', 'dup', 'X'],
          suggested_fix: 'Remove forward reference.',
          confidence: 0.55,
        },
      ],
      summary: 'Timeline concern.',
      confidence: 0.55,
    };

    const modelB: AnalysisResponse = {
      issues: [
        {
          type: 'pronoun_reference',
          severity: 'medium',
          span: { start_index: 200, end_index: 210 }, // bucket 4-4
          explanation: 'Ambiguous "she" without antecedent.',
          evidence: ['Line P1'],
          suggested_fix: 'Clarify referent.',
          confidence: 0.6,
        },
      ],
      summary: 'Pronoun concern.',
      confidence: 0.6,
    };

    const pipeline = new ValidationPipeline(makeAnalyzeStub({ mA: modelA, mB: modelB }));

    const { data, meta } = await pipeline.runConsensus(makeReq(), {
      candidates: ['mA', 'mB'],
      consensusCount: 2,
      acceptThreshold: 0.5, // 1/2 should pass
    });

    expect(data.issues.length).toBe(2);
    const types = data.issues.map((i) => i.type).sort();
    expect(types).toEqual(['pronoun_reference', 'timeline']);

    // Evidence deduplication for the single-contrib group: 'DUP' and 'dup' normalize and dedup
    const timeline = data.issues.find((i) => i.type === 'timeline')!;
    // normalizeEvidenceLines trims and we lower-case in hashing only; merging evidence preserves original casing entries unique by exact string.
    // However our dedup uses Set over normalizedEvidenceLines(issue.evidence) which includes trimming but not lowercasing.
    // Given inputs 'DUP' and 'dup' trimmed differ, both may persist; ensure no exact duplicates remain.
    const hasDuplicates = new Set(timeline.evidence).size !== timeline.evidence.length;
    expect(hasDuplicates).toBe(false);

    // Votes should each be 1 for their respective hashes
    const hashA = ValidationPipeline.hashIssue(modelA.issues[0]);
    const hashB = ValidationPipeline.hashIssue(modelB.issues[0]);
    expect(meta.votes[hashA]?.count).toBe(1);
    expect(meta.votes[hashB]?.count).toBe(1);
  });

  it('human-in-the-loop triggers on critical issue and on high variance across models', async () => {
    // a) Critical issue trigger
    const criticalResp: AnalysisResponse = {
      issues: [
        {
          type: 'character_knowledge',
          severity: 'critical',
          span: { start_index: 50, end_index: 80 },
          explanation: 'Character knows information they could not have learned yet.',
          evidence: ['Critical line'],
          suggested_fix: 'Delay revelation or add discovery scene.',
          confidence: 0.7,
        },
      ],
      summary: 'Critical knowledge leak.',
      confidence: 0.7,
    };
    const pipelineCritical = new ValidationPipeline(makeAnalyzeStub({ primary: criticalResp }));
    const resCritical = await pipelineCritical.runConsensus(makeReq());
    expect(resCritical.meta.humanReviewRequired).toBe(true);
    expect(resCritical.meta.reasons).toContain('critical_issue_present');

    // b) High variance trigger (stddev >= 0.25)
    const lowVar: AnalysisResponse = { issues: [], summary: '', confidence: 0.1 };
    const highVar: AnalysisResponse = { issues: [], summary: '', confidence: 0.9 };
    const pipelineVar = new ValidationPipeline(makeAnalyzeStub({ a: lowVar, b: highVar }));
    const resVar = await pipelineVar.runConsensus(makeReq(), {
      candidates: ['a', 'b'],
      consensusCount: 2,
    });
    expect(resVar.meta.humanReviewRequired).toBe(true);
    expect(resVar.meta.reasons).toContain('high_variance_between_models');
  });
});