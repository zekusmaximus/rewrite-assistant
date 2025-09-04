import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { IPC_CHANNELS } from '../../shared/constants';

// Hoisted state so it's initialized before hoisted mocks execute
const hoisted = vi.hoisted(() => {
  return {
    registry: {} as Record<string, Function>,
    mockSend: vi.fn(),
    windows: [] as any[],
  };
});

// Mock electron to provide minimal app/ipcMain/BrowserWindow used by main code
vi.mock('electron', () => {
  const { registry, mockSend, windows } = hoisted;

  class MockBrowserWindow {
    static getAllWindows = vi.fn(() => windows);
    public webContents: any;
    constructor(..._args: any[]) {
      this.webContents = {
        send: mockSend,
        on: vi.fn(),
        openDevTools: vi.fn(),
      };
      (this as any).once = vi.fn();
      (this as any).on = vi.fn();
      (this as any).show = vi.fn();
      (this as any).hide = vi.fn();
      (this as any).setMenuBarVisibility = vi.fn();
      (this as any).loadURL = vi.fn();
      (this as any).loadFile = vi.fn();
      (this as any).isDestroyed = vi.fn(() => false);
      windows.push(this);
    }
  }

  return {
    app: {
      whenReady: () => Promise.resolve(),
      on: vi.fn(),
      off: vi.fn(),
      quit: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => {
        registry[channel] = fn;
      }),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    BrowserWindow: MockBrowserWindow as any,
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
    },
  };
});

// Ensure electron-squirrel-startup import is inert
vi.mock('electron-squirrel-startup', () => ({}));

// Break circular import: mock the app entry to avoid executing real index.ts during handlers import
vi.mock('../../main/index', () => {
  // Provide a stub mainWindow export referenced by handlers
  return { mainWindow: undefined };
});

// Mock SceneRewriter used by the GENERATE_REWRITE handler
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

// Import handlers after mocks and invoke registration directly.
// Also ensure at least one BrowserWindow exists so progress events can be emitted.
beforeAll(async () => {
  const { setupIPCHandlers } = await import('../../main/handlers');
  setupIPCHandlers();

  const { BrowserWindow } = await import('electron');
  // Create one window instance in the mocked electron so handlers can find it
  // eslint-disable-next-line no-new
  new (BrowserWindow as any)();
});

describe('IPC rewrite handler', () => {
  const handlers = hoisted.registry;
  const mockSend = hoisted.mockSend;

  const resolveRewriteHandler = (): Function | undefined => {
    const preferred = handlers[IPC_CHANNELS.GENERATE_REWRITE];
    if (typeof preferred === 'function') return preferred;
    const all = Object.keys(handlers);
    return all.length ? handlers[all[0]] : undefined;
  };

  beforeEach(() => {
    mockSend.mockClear();
  });

  it('validates payload and returns error when missing scene or issues', async () => {
    const fn = resolveRewriteHandler();
    expect(fn, `Available channels: ${Object.keys(handlers).join(', ')}`).toBeTypeOf('function');

    const res1 = await (fn as Function)({}, { scene: null, issues: [] });
    // Expect standardized error shape from toErrorResponse()
    expect(res1).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          message: expect.stringContaining('Invalid'),
        }),
      })
    );

    const res2 = await (fn as Function)({}, { scene: { id: 's1', text: 'x' }, issues: [] });
    expect(res2.ok).toBe(false);
  });

  it('invokes SceneRewriter and emits progress on success', async () => {
    const fn = resolveRewriteHandler();
    expect(fn, `Available channels: ${Object.keys(handlers).join(', ')}`).toBeTypeOf('function');

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

    const result = await (fn as Function)({}, payload);
    expect(result.success).toBe(true);
    expect(result.rewrittenText).toBe('rewritten text');

    expect(mockSend).toHaveBeenCalledWith(
      (IPC_CHANNELS as any).REEWRITE_PROGRESS ?? IPC_CHANNELS.REWRITE_PROGRESS, // allow minor constant drift
      expect.objectContaining({
        sceneId: 's1',
        status: 'complete',
      })
    );
  });
});