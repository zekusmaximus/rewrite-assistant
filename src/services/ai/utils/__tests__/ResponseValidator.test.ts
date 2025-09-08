import { describe, it, expect } from 'vitest';
import { validateAndNormalize } from '../ResponseValidator';

describe('ResponseValidator.validateAndNormalize (new API)', () => {
  it('accepts strict valid JSON object and returns attempts=1, repaired=false', () => {
    const raw = {
      issues: [
        {
          type: 'timeline',
          severity: 'medium',
          explanation: 'Temporal mismatch detected',
          evidence: ['Prev scene: yesterday; Current: next day'],
          span: { start_index: 10, end_index: 20 },
        },
      ],
      summary: '1 issue found',
    };

    const { data, meta } = validateAndNormalize(raw);
    expect(meta.attempts).toBe(1);
    expect(meta.repaired).toBe(false);

    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.issues.length).toBe(1);
    expect(data.issues[0].type).toBe('timeline');
    expect(data.issues[0].severity).toBe('medium');
    expect(data.issues[0].span).toEqual({ start_index: 10, end_index: 20 });
    expect(typeof data.summary).toBe('string');
  });

  it('repairs fenced json with trailing commas (repaired=true, attempts>1)', () => {
    const raw = [
      '```json',
      '{',
      '  "issues": [',
      '    {',
      '      "type": "timeline",',
      '      "severity": "high",',
      '      "explanation": "Mismatch",',
      '      "evidence": ["a",],',
      '      "span": { "start_index": 1, "end_index": 2 },',
      '    },',
      '  ],',
      '  "summary": "fixed",',
      '}',
      '```',
    ].join('\n');

    const { data, meta } = validateAndNormalize(raw);
    expect(meta.attempts).toBeGreaterThan(1);
    expect(meta.repaired).toBe(true);

    expect(data.issues.length).toBe(1);
    expect(data.issues[0].type).toBe('timeline');
    expect(data.issues[0].severity).toBe('high');
    expect(data.summary).toBeTypeOf('string');
  });

  it('backfills missing confidences within [0,1]', () => {
    const raw = JSON.stringify({
      issues: [
        {
          type: 'other',
          severity: 'low',
          explanation: 'Minor style consideration',
          evidence: ['line 3'],
          // no confidence field
          span: { start_index: 3, end_index: 8 },
        },
        {
          type: 'character_knowledge',
          severity: 'critical',
          explanation: 'Reader could not know this yet',
          evidence: [],
          // no confidence field
          // also missing span entirely
        },
      ],
      summary: '2 issues',
      // no top-level confidence
    });

    const { data } = validateAndNormalize(raw);
    expect(data.issues.length).toBe(2);

    for (const issue of data.issues) {
      expect(typeof issue.confidence).toBe('number');
      expect(issue.confidence).toBeGreaterThanOrEqual(0);
      expect(issue.confidence).toBeLessThanOrEqual(1);
    }

    expect(typeof data.confidence).toBe('number');
    expect(data.confidence).toBeGreaterThanOrEqual(0);
    expect(data.confidence).toBeLessThanOrEqual(1);
  });

  it('tolerates missing span and normalizes to null', () => {
    const raw = {
      issues: [
        {
          type: 'other',
          severity: 'medium',
          explanation: 'General observation',
          evidence: [],
          // span omitted
        },
      ],
      summary: '',
    };

    const { data } = validateAndNormalize(raw);
    expect(data.issues.length).toBe(1);
    expect(data.issues[0].span).toBeNull();
  });
});