import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Scene, ContinuityIssue, ReaderKnowledge } from '../../../../shared/types';
import PronounDetector from '../detectors/PronounDetector';
import TimelineDetector from '../detectors/TimelineDetector';
import CharacterDetector from '../detectors/CharacterDetector';
import PlotContextDetector from '../detectors/PlotContextDetector';
import EngagementDetector from '../detectors/EngagementDetector';
import AIServiceManager from '../../../../services/ai/AIServiceManager';
import KeyGateTestDouble from '../../../../services/ai/KeyGate.testdouble';
import { ValidationPipeline } from '../../../../services/ai/validation/ValidationPipeline';

type AnalyzeReq = Parameters<AIServiceManager['analyzeContinuity']>[0];

function buildScene(overrides?: Partial<Scene>): Scene {
  const base: Scene = {
    id: 's1',
    text: 'Alice looked at Bob. They went home together.',
    wordCount: 7,
    position: 3,
    originalPosition: 1,
    characters: ['Alice', 'Bob'],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: true,
    rewriteStatus: 'pending',
  };
  return { ...base, ...(overrides ?? {}) } as Scene;
}

function buildPrev(n = 2): Scene[] {
  return Array.from({ length: n }).map((_, i) => ({
    id: `p${i + 1}`,
    text: `Prev ${i + 1} text with Alice and Bob context.`,
    wordCount: 6,
    position: i,
    originalPosition: i,
    characters: ['Alice'],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: false,
    rewriteStatus: 'pending',
  })) as Scene[];
}

function _buildReader(): ReaderKnowledge {
  return {
    knownCharacters: new Set(['Alice']),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };
}

function makeManagerStub(recorded: AnalyzeReq[]) {
  const stub: Pick<AIServiceManager, 'analyzeContinuity'> = {
    analyzeContinuity: vi.fn(async (req: AnalyzeReq) => {
      recorded.push(req);
      const issues: ContinuityIssue[] = []; // return empty to keep mapping deterministic
      return {
        issues,
        metadata: {
          modelUsed: (req as any).__modelId ?? 'mock',
          provider: 'openai',
          costEstimate: 0,
          durationMs: 1,
          confidence: 0.6,
          cached: false,
        },
      };
    }) as any,
  };
  return stub as AIServiceManager;
}

describe('Detector integration - AnalysisRequest enrichment and consensus adapter', () => {
  let mockKeyGate: KeyGateTestDouble;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockKeyGate = new KeyGateTestDouble();
    mockKeyGate.setMockSettings({
      providers: {
        claude: { apiKey: 'test-claude-key', model: 'claude-3-sonnet' }
      }
    });
    mockKeyGate.setMockConnectionResult('claude', { success: true });
  });

  it('non-critical pronoun request: single analyze call with enriched fields', async () => {
    const calls: AnalyzeReq[] = [];
    const manager = makeManagerStub(calls);
    const det = new PronounDetector(mockKeyGate);

    const scene = buildScene({ position: 7 } as any); // no critical flag
    const prev = buildPrev(3);
    await det.detect(scene, prev, manager);

    // One AI call expected (enrichment path uses single-run)
    expect(calls.length).toBe(1);
    const req = calls[0] as any;

    // Required enriched fields presence
    expect(req).toBeTruthy();
    expect(req.scene).toBeTruthy();
    expect(req.readerContext).toBeTruthy();
    expect(req.previousScenes).toBeTruthy();

    // taskType/detector label
    expect(req.taskType).toBe('pronoun');
    expect(req.detector).toBe('pronoun');

    // sceneText and newPosition meta added (local-only)
    expect(typeof req.sceneText).toBe('string');
    expect(req.sceneText).toContain('Alice looked at Bob');

    expect(typeof req.newPosition).toBe('number');
    expect(req.newPosition).toBe(7);

    // previousScenes truncated/compacted upstream but is an array
    expect(Array.isArray(req.previousScenes)).toBe(true);

    // readerContext knownCharacters is a Set
    expect(req.readerContext.knownCharacters instanceof Set).toBe(true);
  });

  it('critical pronoun request: consensus path calls analyze twice with distinct modelId', async () => {
    const calls: AnalyzeReq[] = [];
    const manager = makeManagerStub(calls);
    const det = new PronounDetector(mockKeyGate);

    const scene = buildScene({ position: 4 } as any);
    (scene as any).critical = true; // signal critical
    const prev = buildPrev(2);

    // Spy on reconcile to ensure consensus path engaged
    const spyRecon = vi.spyOn(ValidationPipeline, 'reconcile');

    await det.detect(scene, prev, manager);

    // Two calls expected (consensus with default 2 candidates)
    expect(calls.length).toBe(2);

    const modelIds = new Set((calls.map((r: any) => r.__modelId).filter(Boolean)));
    expect(modelIds.size).toBeGreaterThanOrEqual(2); // distinct per candidate

    // Each call still carries enriched fields
    for (const req of calls as any[]) {
      expect(req.taskType).toBe('pronoun');
      expect(typeof req.sceneText).toBe('string');
    }

    expect(spyRecon).toHaveBeenCalledTimes(1);
  });

  it('timeline detector honors enrichment and consensus flags', async () => {
    const calls: AnalyzeReq[] = [];
    const manager = makeManagerStub(calls);
    const det = new TimelineDetector(mockKeyGate);

    // Provide clear temporal markers so localDetection will produce targets (and trigger AI)
    const scene = buildScene({
      text: 'Next morning, the sky cleared. Later that day, rain returned. Meanwhile, plans were made.',
    } as any);
    (scene as any).critical = true;
    const prev = buildPrev(1);

    await det.detect(scene, prev, manager);
    expect(calls.length).toBe(2);
    for (const req of calls as any[]) {
      expect(req.taskType).toBe('timeline');
      expect(typeof req.sceneText).toBe('string');
    }
  });

  it('character detector single-run when not critical', async () => {
    const calls: AnalyzeReq[] = [];
    const manager = makeManagerStub(calls);
    const det = new CharacterDetector(mockKeyGate);

    const scene = buildScene({ text: 'Eve met Mallory. "Sis," she said.' } as any);
    const prev = buildPrev(2);

    await det.detect(scene, prev, manager);
    // Could be 0 or 1 depending on targets; we assert at most one (no consensus)
    expect(calls.length).toBeLessThanOrEqual(1);
    if (calls.length === 1) {
      const req = calls[0] as any;
      expect(req.taskType).toBe('character');
    }
  });

  it('plot/engagement detectors set proper taskType and pass enriched meta', async () => {
    const callsPlot: AnalyzeReq[] = [];
    const callsEng: AnalyzeReq[] = [];
    const managerPlot = makeManagerStub(callsPlot);
    const managerEng = makeManagerStub(callsEng);

    const plot = new PlotContextDetector(mockKeyGate);
    const engage = new EngagementDetector(mockKeyGate);

    const scenePlot = buildScene({ text: 'The incident shocked the town. What happened would change everything.' } as any);
    const sceneEng = buildScene({ text: 'It was the best of times, it was the worst of times. Dialogue starts. "Hello."' } as any);

    await plot.detect(scenePlot, buildPrev(2), managerPlot);
    await engage.detect(sceneEng, buildPrev(1), managerEng);

    if (callsPlot.length > 0) {
      expect((callsPlot[0] as any).taskType).toBe('plot');
      expect(typeof (callsPlot[0] as any).sceneText).toBe('string');
    }
    if (callsEng.length > 0) {
      expect((callsEng[0] as any).taskType).toBe('engagement');
      expect(typeof (callsEng[0] as any).sceneText).toBe('string');
    }
  });
});