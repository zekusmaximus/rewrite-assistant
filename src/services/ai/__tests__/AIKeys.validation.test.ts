import { describe, test, expect } from 'vitest';
import AIServiceManager from '../AIServiceManager';
import { ProviderError } from '../types';
import { MissingKeyError } from '../errors/AIServiceErrors';
import KeyGateTestDouble from '../KeyGate.testdouble';

// Minimal fixtures
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

describe('AI Keys and Configuration Validation', () => {
  test('missing keys path throws MissingKeyError via KeyGate.requireKey', async () => {
    const gate = new KeyGateTestDouble();
    // Configure empty settings to simulate missing keys
    gate.setMockSettings({ providers: {} });
    await expect(gate.requireKey('claude', { validate: true })).rejects.toBeInstanceOf(MissingKeyError);
  });

  test('invalid claude key configuration results in ProviderError from provider', async () => {
    const manager = new AIServiceManager();
    manager.configure({
      claude: { apiKey: 'invalid-key', model: 'claude-sonnet-4' },
    });

    const req = {
      scene,
      previousScenes,
      analysisType: 'simple' as const,
      readerContext,
    };

    // Mock the KeyGate to simulate invalid key behavior
    const mockGate = new KeyGateTestDouble();
    mockGate.setMockConnectionResult('claude', { success: false, error: 'Invalid API key' });
    mockGate.setMockSettings({
      providers: {
        claude: { apiKey: 'invalid-key', model: 'claude-sonnet-4' }
      }
    });

    // Replace the KeyGate instance in the manager with our test double
    (manager as any).keyGate = mockGate;

    await expect(manager.analyzeContinuity(req)).rejects.toBeInstanceOf(ProviderError);
  });
});