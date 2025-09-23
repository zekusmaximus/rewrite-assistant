import { describe, test, expect } from 'vitest';
import AIServiceManager from '../AIServiceManager';
import { ProviderError } from '../types';
import { MissingKeyError } from '../errors/AIServiceErrors';
import KeyGate from '../KeyGate';

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
    const gate = new KeyGate();
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

    await expect(manager.analyzeContinuity(req)).rejects.toBeInstanceOf(ProviderError);
  });
});