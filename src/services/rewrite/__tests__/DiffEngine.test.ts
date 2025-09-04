import { describe, it, expect } from 'vitest';
import DiffEngine from '../DiffEngine';
import type { DiffSegment } from '../../../shared/types';

describe('DiffEngine (Phase 3.1 basic)', () => {
  it('returns single unchanged segment when texts are identical', () => {
    const segs = DiffEngine.generateDiff('same', 'same');
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('unchanged');
    expect(segs[0].text).toBe('same');
    expect(segs[0].startIndex).toBe(0);
    expect(segs[0].endIndex).toBe(4);
  });

  it('returns single added segment when original is empty', () => {
    const segs = DiffEngine.generateDiff('', 'hello');
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('added');
    expect(segs[0].text).toBe('hello');
    expect(segs[0].startIndex).toBe(0);
    expect(segs[0].endIndex).toBe(5);
  });

  it('returns single removed segment when rewritten is empty', () => {
    const segs = DiffEngine.generateDiff('hello', '');
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('removed');
    expect(segs[0].text).toBe('hello');
    expect(segs[0].startIndex).toBe(0);
    expect(segs[0].endIndex).toBe(5);
  });

  it('represents full replacement with removed + added segments otherwise', () => {
    const segs = DiffEngine.generateDiff('abc', 'xyz');
    expect(segs).toHaveLength(2);
    expect(segs[0].type).toBe('removed');
    expect(segs[0].text).toBe('abc');
    expect(segs[1].type).toBe('added');
    expect(segs[1].text).toBe('xyz');
  });

  it('summarizes changes correctly', () => {
    const segs: DiffSegment[] = [
      { type: 'added', text: 'x', startIndex: 0, endIndex: 1 },
      { type: 'removed', text: 'y', startIndex: 0, endIndex: 1 },
      { type: 'unchanged', text: 'z', startIndex: 0, endIndex: 1 },
    ];
    const summary = DiffEngine.summarizeChanges(segs);
    expect(summary).toContain('1 additions');
    expect(summary).toContain('1 deletions');
    expect(summary).toContain('1 unchanged sections');
  });

  it('calculates similarity using length ratio placeholder', () => {
    expect(DiffEngine.calculateSimilarity('abc', 'abc')).toBe(100);
    expect(DiffEngine.calculateSimilarity('', '')).toBe(100);
    expect(DiffEngine.calculateSimilarity('', 'x')).toBe(0);
    expect(DiffEngine.calculateSimilarity('abcd', 'ab')).toBe(50);
  });
});