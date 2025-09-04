import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPC_CHANNELS } from '../../shared/constants';

// Mock electron ipcMain and BrowserWindow to capture handler registration and event emission
const handlers: Record<string, Function> = {};
const mockSend = vi.fn();

vi.mock('electron', () => {
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => {
        handlers[channel] = fn;
      }),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => [
        {
          isDestroyed: () => false,
          webContents: { send: mockSend },
        } as any,
      ]),
    },
  };
});

// Mock SceneRewriter used inside handlers.ts to control rewrite output
vi.mock('../../services/rewrite/SceneRewriter', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        rewriteScene: vi.fn().mockResolvedValue({
          success: true,
          rewrittenText: 'rewritten text',
          issuesAddressed: [],
          changesExplanation: 'mocked explanation',
          preservedElements: [],
          diffData: [],
          modelUsed: 'mock-model',
        }),
      };
    }),
  };
});

// Import after mocks to trigger handler registration
import '../../main/handlers';

describe('IPC rewrite handler', () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  it('validates payload and returns error when missing scene or issues', async () => {
    const fn = handlers[IPC_CHANNELS.GENERATE_REWRITE];
    expect(typeof fn).toBe('function');

    const res1 = await fn({}, { scene: null, issues: [] });
    expect(res1).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Invalid request'),
      })
    );

    const res2 = await fn({}, { scene: { id: 's1', text: 'x' }, issues: [] });
    expect(res2.success).toBe(false);
  });

  it('invokes SceneRewriter and emits progress on success', async () => {
    const fn = handlers[IPC_CHANNELS.GENERATE_REWRITE];
    const payload = {
      sceneId: 's1',
      scene: { id: 's1', text: 'original' },
      issues: [{ id: 'i1', type: 'pronoun', severity: 'should-fix', description: 'x' }],
      previousScenes: [],
      readerContext: {
        knownCharacters: new Set(['Alice']),
        establishedTimeline: [],
        revealedPlotPoints: [],
        establishedSettings: [],
      },
      preserveElements: [],
    };

    const result = await fn({}, payload);
    expect(result.success).toBe(true);
    expect(result.rewrittenText).toBe('rewritten text');

    // Progress event emitted
    expect(mockSend).toHaveBeenCalledWith(
      IPC_CHANNELS.REWRITE_PROGRESS,
      expect.objectContaining({
        sceneId: 's1',
        status: 'complete',
      })
    );
  });
});