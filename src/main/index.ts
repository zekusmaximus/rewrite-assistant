import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import { APP_CONFIG } from '../shared/constants';
import { setupIPCHandlers } from './handlers';
import KeyGate from '../services/ai/KeyGate';
import { AIServiceError, MissingKeyError } from '../services/ai/errors/AIServiceErrors';
import settingsService from './services/SettingsService';

// Handle creating/removing shortcuts on Windows when installing/uninstalling (Windows only).
if (process.platform === 'win32') {
  try {
    // Optional in dev; present in production on Windows. If missing, ignore.
     
    if (require('electron-squirrel-startup')) {
      app.quit();
      // Do not continue starting the app when handling Squirrel events.
      // No 'return' at top-level; app.quit() is sufficient.
    }
  } catch {
    // Module not found (e.g., dev or non-Windows env) — safely ignore.
  }
}

// Keep exported type as BrowserWindow to avoid breaking existing imports in handlers.
let mainWindow: BrowserWindow;

// Health monitor interval (cleared on quit/close)
let healthMonitorInterval: NodeJS.Timeout | null = null;

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
 * Validate that at least one AI provider is correctly configured and healthy.
 * Throws MissingKeyError (or a subclass of AIServiceError) when no provider is working.
 */
async function validateAIServicesOnStartup(): Promise<void> {
  ensureKeyGateShim();
  const keyGate = new KeyGate();
  const status = await keyGate.checkAllProviders();

  if (!status.hasWorkingProvider) {
    // Use generic provider label to satisfy constructor; userMessage communicates requirement clearly.
    throw new MissingKeyError('any');
  }
}

/**
 * Show a blocking modal indicating AI services configuration is required.
 * - Configure: opens the main window (without validation) and triggers 'open-settings-modal'
 * - Exit: quits the app
 */
async function showAIConfigurationRequired(error: Error): Promise<void> {
  const detail =
    error instanceof AIServiceError ? error.userMessage : (error?.message || 'Unknown AI configuration error');

  const attachTo = BrowserWindow.getAllWindows()[0];

  const opts = {
    type: 'error' as const,
    title: 'AI Services Required',
    message: 'This application requires AI services to function.',
    detail,
    buttons: ['Configure API Keys', 'Exit'] as string[],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };

  const result = attachTo && !attachTo.isDestroyed()
    ? await dialog.showMessageBox(attachTo, opts)
    : await dialog.showMessageBox(opts);

  // Configure
  if (result.response === 0) {
    // Ensure a window exists but do not re-run validation
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    }

    const win = (!mainWindow || mainWindow.isDestroyed()) ? BrowserWindow.getAllWindows()[0] : mainWindow;

    if (win && !win.isDestroyed()) {
      const sendOpenSettings = (): void => {
        try {
          win.webContents.send('open-settings-modal');
        } catch {
          // ignore
        }
      };
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', sendOpenSettings);
      } else {
        sendOpenSettings();
      }
    }
    return;
  }

  // Exit
  app.quit();
}

/**
 * Start periodic AI health monitoring (every 30s).
 * - Notifies renderer via 'ai-services-unavailable' when no providers work
 * - Shows dialog offering 'Check Settings' or 'Exit'
 * - Avoid async directly in setInterval to satisfy eslint no-misused-promises
 */
function startAIHealthMonitoring(): void {
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
    healthMonitorInterval = null;
  }

  healthMonitorInterval = setInterval(() => {
    void (async () => {
      try {
        ensureKeyGateShim();
        const keyGate = new KeyGate();
        const status = await keyGate.checkAllProviders();

        if (!status.hasWorkingProvider) {
          const win = (mainWindow && !mainWindow.isDestroyed())
            ? mainWindow
            : BrowserWindow.getAllWindows()[0];

          // Notify renderer to disable AI-dependent features
          try {
            if (win && !win.isDestroyed()) {
              win.webContents.send('ai-services-unavailable');
            }
          } catch {
            // ignore
          }

          const options = {
            type: 'warning' as const,
            title: 'AI Services Unavailable',
            message: 'AI services are no longer available.',
            detail: 'The application cannot function without AI services.',
            buttons: ['Check Settings', 'Exit'] as string[],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          };

          let res: { response: number };
          if (win && !win.isDestroyed()) {
            res = await dialog.showMessageBox(win, options);
          } else {
            res = await dialog.showMessageBox(options);
          }

          if (res.response === 0) {
            // Open settings in renderer
            if (win && !win.isDestroyed()) {
              try {
                win.webContents.send('open-settings-modal');
              } catch {
                // ignore
              }
            }
          } else {
            app.quit();
          }
        }
      } catch {
        // silent - monitoring should be resilient
      }
    })();
  }, 30_000);
}

/**
 * Orchestrate app boot with validation so createWindow() stays pure.
 */
async function bootApplicationWithValidation(): Promise<void> {
  try {
    await validateAIServicesOnStartup();
    createWindow();

    // Suppress harmless Autofill errors (duplicate guard kept for robustness)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('console-message', (event, _level, message) => {
        if (message.includes('Autofill.enable')) {
          event.preventDefault();
        }
      });
    }

    setupIPCHandlers();
    startAIHealthMonitoring();
  } catch (err) {
    // Show configuration dialog; on 'Configure' a window will be created and settings opened
    await showAIConfigurationRequired(err as Error);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  void bootApplicationWithValidation();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
});

// Export mainWindow for use in handlers
export { mainWindow };
