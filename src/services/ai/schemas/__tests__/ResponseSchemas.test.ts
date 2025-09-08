import { describe, it, expect } from 'vitest';
import { AnalysisResponseSchema } from '../ResponseSchemas';

describe('ResponseSchemas', () => {
  it('parses a valid minimal payload with issues', () => {
    const payload = {
      issues: [
        {
          type: 'timeline',
          severity: 'medium',
          explanation: 'Temporal inconsistency between scenes',
          evidence: ['Previous scene says "yesterday", current says "next day"'],
          span: { start_index: 5, end_index: 25 },
        },
      ],
      summary: 'Detected one timeline inconsistency',
    };

    const result = AnalysisResponseSchema.parse(payload);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe('timeline');
    expect(result.issues[0].severity).toBe('medium');
    expect(result.issues[0].span).toEqual({ start_index: 5, end_index: 25 });
    expect(typeof result.summary).toBe('string');
  });

  it('rejects invalid issue type and severity', () => {
    const bad = {
      issues: [
        {
          type: 'bad_type',
          severity: 'extreme',
          explanation: 'Invalid values',
        },
      ],
      summary: '',
    };

    const parsed = AnalysisResponseSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });
});