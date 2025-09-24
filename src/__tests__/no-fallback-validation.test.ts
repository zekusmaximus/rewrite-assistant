import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import AIServiceManager from '../services/ai/AIServiceManager';
import KeyGateTestDouble from '../services/ai/KeyGate.testdouble';
import { MissingKeyError, InvalidKeyError } from '../services/ai/errors/AIServiceErrors';
import { ProviderError } from '../services/ai/types';
import * as CB from '../services/ai/utils/CircuitBreaker';

// Minimal fixtures mirrored from AI keys validation tests
const scene = {
  id: 's1',
  text: 'She enters the room. He looks away.',
  position: 0,
  originalPosition: 0,
  characters: ['Alice', 'Bob'],
  timeMarkers: [],
  locationMarkers: [],
  hasBeenMoved: false,
  rewriteStatus: 'pending',
} as any;

const previousScenes: any[] = [];

const readerContext = {
  knownCharacters: new Set<string>(['Alice', 'Bob']),
  establishedTimeline: [],
  revealedPlotPoints: [],
  establishedSettings: [],
};

let ORIGINAL_ENV: NodeJS.ProcessEnv;
let originalFetch: any;
let originalWindow: any;

beforeEach(() => {
  ORIGINAL_ENV = { ...process.env };
  originalFetch = (globalThis as any).fetch;
  originalWindow = (globalThis as any).window;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  if (originalFetch !== undefined) {
    (globalThis as any).fetch = originalFetch;
  } else {
    delete (globalThis as any).fetch;
  }
  if (originalWindow === undefined) {
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = originalWindow;
  }
  vi.restoreAllMocks();
});

describe('No-Fallback Policy Validation', () => {
  describe('API Key Removal Tests', () => {
    test('Startup validation fails with no keys', async () => {
      const gate = new KeyGateTestDouble();
      // Configure empty settings to simulate missing keys
      gate.setMockSettings({ providers: {} });
      await expect(gate.requireKey('claude', { validate: true })).rejects.toBeInstanceOf(MissingKeyError);
      await expect(gate.requireKey('openai', { validate: true })).rejects.toBeInstanceOf(MissingKeyError);
      await expect(gate.requireKey('gemini', { validate: true })).rejects.toBeInstanceOf(MissingKeyError);

      const health = await gate.checkAllProviders();
      expect(health.hasWorkingProvider).toBe(false);
      expect(health.workingProviders.length).toBe(0);
    });

    test('Analysis calls fail with no keys', async () => {
      const manager = new AIServiceManager();
      // Configure with empty settings to simulate no keys scenario
      manager.configure({});

      const req = {
        scene,
        previousScenes,
        analysisType: 'simple' as const,
        readerContext,
      };
      await expect(manager.analyzeContinuity(req)).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('Network Disconnection Tests', () => {
    test('Mock fetch to reject with a network error; ensure analysis path rejects appropriately', async () => {
      const manager = new AIServiceManager();
      manager.configure({
        openai: { apiKey: 'test-key', model: 'gpt-5', timeoutMs: 1000 },
      });

      (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('network down'));
      // Reduce retry attempts and eliminate backoff to keep test under 5s
      vi.spyOn(CB, 'backoffSchedule').mockReturnValue([0]);

      const req = {
        scene,
        previousScenes,
        analysisType: 'simple' as const,
        readerContext,
      };
      await expect(manager.analyzeContinuity(req)).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('Service Validation Tests', () => {
    test('Invalid keys are rejected immediately in key validation', async () => {
      const gate = new KeyGateTestDouble();
      // Configure mock settings and connection result to simulate invalid key
      gate.setMockSettings({
        providers: {
          claude: { apiKey: 'invalid-key' },
        },
      });
      gate.setMockConnectionResult('claude', { success: false, error: 'invalid' });

      await expect(gate.requireKey('claude', { validate: true })).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test('All providers return 503 -> health shows no working provider', async () => {
      const gate = new KeyGateTestDouble();
      // Configure mock settings and connection results to simulate 503 errors
      gate.setMockSettings({
        providers: {
          claude: { apiKey: 'k1' },
          openai: { apiKey: 'k2' },
          gemini: { apiKey: 'k3' },
        },
      });
      gate.setMockConnectionResult('claude', { success: false, error: '503 Service Unavailable' });
      gate.setMockConnectionResult('openai', { success: false, error: '503 Service Unavailable' });
      gate.setMockConnectionResult('gemini', { success: false, error: '503 Service Unavailable' });

      const health = await gate.checkAllProviders();
      expect(health.hasWorkingProvider).toBe(false);
      expect(health.workingProviders).toEqual([]);
    });
  });
});