import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchAnalyze } from '../RequestBatcher';
import type { AnalysisRequest } from '../../types';

function makeReq(text: string): AnalysisRequest {
  return {
    scene: {
      id: 's1',
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      position: 1,
      originalPosition: 1,
      characters: [],
      timeMarkers: [],
      locationMarkers: [],
      hasBeenMoved: false,
      rewriteStatus: 'pending',
    },
    previousScenes: [],
    analysisType: 'simple',
    readerContext: {
      knownCharacters: new Set<string>(),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: [],
    },
  };
}

describe('RequestBatcher batchAnalyze', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('deduplicates by key when deDupeByKey=true and preserves ordering', async () => {
    const calls: Record<string, number> = {};
    const runner = vi.fn(async (req: AnalysisRequest) => {
      const key = req.scene.text;
      calls[key] = (calls[key] ?? 0) + 1;
      // Simulate async delay
      await new Promise((r) => setTimeout(r, 5));
      return `res:${key}`;
    });

    const requests = [
      { key: 'A', req: makeReq('A') },
      { key: 'B', req: makeReq('B') },
      { key: 'A', req: makeReq('A') }, // duplicate
      { key: 'C', req: makeReq('C') },
      { key: 'B', req: makeReq('B') }, // duplicate
    ];

    const p = batchAnalyze(requests, runner, { deDupeByKey: true, concurrency: 3 });
    // Advance all timers to resolve async runner delays
    await vi.runAllTimersAsync();
    const out = await p;

    expect(out.map((o) => o.key)).toEqual(['A', 'B', 'A', 'C', 'B']);
    expect(out.map((o) => o.result)).toEqual(['res:A', 'res:B', 'res:A', 'res:C', 'res:B']);

    // Runner should have been called only once per unique key
    expect(Object.keys(calls).sort()).toEqual(['A', 'B', 'C']);
    expect(calls['A']).toBe(1);
    expect(calls['B']).toBe(1);
    expect(calls['C']).toBe(1);
  });

  it('honors concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const runner = vi.fn(async (_req: AnalysisRequest) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Simulate work
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return 'ok';
    });

    const requests = Array.from({ length: 10 }, (_v, i) => ({ key: `K${i}`, req: makeReq(`T${i}`) }));
    const p = batchAnalyze(requests, runner, { deDupeByKey: false, concurrency: 3 });

    await vi.runAllTimersAsync();
    await p;

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(runner).toHaveBeenCalledTimes(10);
  });
});