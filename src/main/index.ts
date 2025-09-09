import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { APP_CONFIG } from '../shared/constants';
import { setupIPCHandlers } from './handlers';

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

let mainWindow: BrowserWindow;

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
    mainWindow.loadURL('http://localhost:5173');
    // Suppress noisy dev tools errors in development
    mainWindow.webContents.on('console-message', (event, level, message) => {
      // Suppress autofill and other dev tools noise
      if (message.includes('Autofill.enable') ||
          message.includes('Autofill.setAddresses') ||
          message.includes('Request Autofill')) {
        event.preventDefault();
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/main_window/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open the DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  createWindow();

  // Suppress harmless Autofill errors
  mainWindow.webContents.on('console-message', (event, level, message) => {
    if (message.includes('Autofill.enable')) {
      event.preventDefault();
    }
  });

  setupIPCHandlers();

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

// Export mainWindow for use in handlers
export { mainWindow };

