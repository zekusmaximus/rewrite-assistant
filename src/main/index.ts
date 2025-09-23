import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { APP_CONFIG } from '../shared/constants';
import { setupIPCHandlers } from './handlers';
import KeyGate from '../services/ai/KeyGate';
import settingsService from './services/SettingsService';
import type { ProviderName } from '../services/ai/types';

// Keep exported type as BrowserWindow to avoid breaking existing imports in handlers.
let mainWindow: BrowserWindow;

// Health monitor interval (cleared on quit/close)
let healthMonitorInterval: NodeJS.Timeout | null = null;

// Track previous availability to emit degraded notifications
let lastAvailability: boolean | null = null;
// Ensure we don't spam configuration notices
let configurationNoticeSent = false;

// Map KeyGate short names to ProviderName used across AIServiceManager
const KEYGATE_TO_PROVIDER_NAME: Record<'claude' | 'openai' | 'gemini', ProviderName> = {
  claude: 'anthropic',
  openai: 'openai',
  gemini: 'google',
};

type AIStatusPayload = {
  available: boolean;
  workingProviders: ProviderName[];
  needsConfiguration: boolean;
};

/**
 * Shim KeyGate IPC calls when used from the main process.
 * KeyGate is written to call window.electronAPI.* (renderer). In main, we bridge to SettingsService.
 */
function ensureKeyGateShim(): void {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) {
    g.window = {};
  }
  const win = g.window as Record<string, unknown>;
  if (!win.electronAPI) {
    (win as any).electronAPI = {
      loadSettings: (): Promise<any> => settingsService.loadSettings(),
      testConnection: (params: any): Promise<{ success: boolean; error?: string }> =>
        settingsService.testConnection(params?.provider, params?.config),
    };
  }
}

/**
 * Create the BrowserWindow (idempotent; no validation in this function).
 */
const createWindow = (): void => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    height: APP_CONFIG.WINDOW_HEIGHT,
    width: APP_CONFIG.WINDOW_WIDTH,
    minHeight: APP_CONFIG.MIN_WINDOW_HEIGHT,
    minWidth: APP_CONFIG.MIN_WINDOW_WIDTH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
    titleBarStyle: 'default',
    show: false, // Don't show until ready
  });

  // Load the index.html of the app.
  if (process.env.NODE_ENV === 'development') {
    void mainWindow.loadURL('http://localhost:5173');

    // Suppress noisy dev tools errors in development
    mainWindow.webContents.on('console-message', (event, _level, message) => {
      // Suppress autofill and other dev tools noise
      if (
        message.includes('Autofill.enable') ||
        message.includes('Autofill.setAddresses') ||
        message.includes('Request Autofill')
      ) {
        event.preventDefault();
      }
    });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/main_window/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Open the DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Clear monitoring when window is closed to avoid leaks (will restart on next successful boot)
  mainWindow.on('closed', () => {
    if (healthMonitorInterval) {
      clearInterval(healthMonitorInterval);
      healthMonitorInterval = null;
    }
  });
};

/**
 * Compute current AI services status non-blockingly.
 * Never throws; always resolves with a best-effort payload.
 */
async function computeAIStatus(): Promise<{ payload: AIStatusPayload; noneConfigured: boolean }> {
  ensureKeyGateShim();

  // Default pessimistic values
  let available = false;
  let workingProviders: ProviderName[] = [];
  let needsConfiguration = true;
  let noneConfigured = true;

  try {
    const settings = await settingsService.loadSettings();
    const providers = (settings?.providers ?? {}) as Record<string, { apiKey?: string }>;
    const configured: Array<'claude' | 'openai' | 'gemini'> = ['claude', 'openai', 'gemini'].filter((p) => {
      const key = (providers as any)?.[p]?.apiKey;
      return typeof key === 'string' && key.trim().length > 0;
    }) as Array<'claude' | 'openai' | 'gemini'>;

    noneConfigured = configured.length === 0;

    // If nothing configured at all -> needsConfiguration true, available false
    if (noneConfigured) {
      available = false;
      workingProviders = [];
      needsConfiguration = true;
    } else {
      // Validate configured providers cheaply via KeyGate (cached validation)
      const gate = new KeyGate();
      const status = await gate.checkAllProviders().catch((err: unknown) => {
        console.warn('[Main] AI status check failed (continuing):', (err as Error)?.message ?? String(err));
        return { hasWorkingProvider: false, workingProviders: [] as Array<'claude' | 'openai' | 'gemini'> };
      });

      const mapped = (status.workingProviders || []).map((p) => KEYGATE_TO_PROVIDER_NAME[p]);
      workingProviders = mapped.filter(Boolean) as ProviderName[];
      available = workingProviders.length > 0;
      // Per spec: needsConfiguration true if no configured keys OR keys invalid/missing (i.e., none working)
      needsConfiguration = !available;
    }
  } catch (err) {
    console.error('[Main] Unexpected error while computing AI status (continuing):', (err as Error)?.message ?? String(err));
    available = false;
    workingProviders = [];
    needsConfiguration = true;
    noneConfigured = true;
  }

  return {
    payload: {
      available,
      workingProviders,
      needsConfiguration,
    },
    noneConfigured,
  };
}

/**
 * Send a one-shot non-blocking AI status after window creation.
 * Returns void; never throws.
 */
async function detectAIServicesOnStartup(): Promise<void> {
  try {
    const { payload, noneConfigured } = await computeAIStatus();

    // Update lastAvailability for degraded detection
    lastAvailability = payload.available;

    // Only send if renderer likely ready; otherwise skip (monitor will fire later)
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      try {
        win.webContents.send('ai-services-status', payload);
      } catch (err) {
        console.warn('[Main] Failed to send ai-services-status (continuing):', (err as Error)?.message ?? String(err));
      }

      if (noneConfigured && !configurationNoticeSent) {
        try {
          win.webContents.send('show-ai-configuration-notice');
          configurationNoticeSent = true;
        } catch (err) {
          console.warn('[Main] Failed to send show-ai-configuration-notice (continuing):', (err as Error)?.message ?? String(err));
        }
      }
    } else {
      console.warn('[Main] Renderer not ready; skipping initial AI status dispatch');
    }
  } catch {
    // Swallow all
  }
}

/**
 * Start periodic AI health monitoring (every 30s).
 * - Re-emits 'ai-services-status' updates
 * - Emits 'ai-services-degraded' when previously available and now no providers work
 * - Never throws; logs errors and continues
 */
function startAIHealthMonitoring(): void {
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
    healthMonitorInterval = null;
  }

  healthMonitorInterval = setInterval(() => {
    void (async () => {
      try {
        const { payload } = await computeAIStatus();

        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.send('ai-services-status', payload);
          } catch (err) {
            console.warn('[Main] Failed to send ai-services-status (continuing):', (err as Error)?.message ?? String(err));
          }

          // Degraded: was available, now unavailable
          if (lastAvailability === true && payload.available === false) {
            try {
              win.webContents.send('ai-services-degraded');
            } catch (err) {
              console.warn('[Main] Failed to send ai-services-degraded (continuing):', (err as Error)?.message ?? String(err));
            }
          }
        }

        lastAvailability = payload.available;
      } catch (err) {
        console.warn('[Main] AI health monitor iteration failed (continuing):', (err as Error)?.message ?? String(err));
      }
    })();
  }, 30_000);
}

/**
 * IPC: Renderer requests an immediate AI status check.
 * Always responds by emitting 'ai-services-status' (event-based). Returns void; never throws.
 */
function registerAIStatusIPC(): void {
  try {
    ipcMain.on('check-ai-status', () => {
      void (async () => {
        try {
          const { payload } = await computeAIStatus();
          const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            try {
              win.webContents.send('ai-services-status', payload);
            } catch (err) {
              console.warn('[Main] Failed to send ai-services-status (on demand):', (err as Error)?.message ?? String(err));
            }
          }
        } catch (err) {
          console.warn('[Main] check-ai-status handler failed (continuing):', (err as Error)?.message ?? String(err));
        }
      })();
    });
  } catch (err) {
    console.warn('[Main] Failed to register check-ai-status IPC (continuing):', (err as Error)?.message ?? String(err));
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling (Windows only).
if (process.platform === 'win32') {
  try {
    // Optional in dev; present in production on Windows. If missing, ignore.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (require('electron-squirrel-startup')) {
      app.quit();
      // Do not continue starting the app when handling Squirrel events.
      // No 'return' at top-level; app.quit() is sufficient.
    }
  } catch {
    // Module not found (e.g., dev or non-Windows env) — safely ignore.
  }
}

/**
 * Boot application non-blockingly:
 * - Always create the window
 * - Then run AI detection and start monitoring
 */
function bootApplication(): void {
  createWindow();

  // Minimal console-message suppression kept for robustness
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.on('console-message', (event, _level, message) => {
      if (message.includes('Autofill.enable')) {
        event.preventDefault();
      }
    });
  }

  setupIPCHandlers();
  registerAIStatusIPC();

  // Non-blocking AI detection and monitoring
  void detectAIServicesOnStartup();
  startAIHealthMonitoring();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  bootApplication();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      // After creating a new window, ensure monitoring continues and an initial status is dispatched
      void detectAIServicesOnStartup();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Ensure health monitor is cleared on shutdown
app.on('before-quit', () => {
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
    healthMonitorInterval = null;
  }
  // Cleanup IPC listeners to avoid leaks on reload/quit
  try {
    ipcMain.removeAllListeners('check-ai-status');
  } catch {
    // ignore
  }
});

// Export mainWindow for use in handlers
export { mainWindow };
