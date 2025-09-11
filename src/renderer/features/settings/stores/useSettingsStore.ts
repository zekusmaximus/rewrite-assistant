import { create } from 'zustand';
import type { ProviderName, ProviderConfig, ProvidersConfigMap } from '../types';

// Phase 1: In-memory-only settings store. No persistence; no IPC.
// TODO(Phase 2/3): Integrate persistence via Electron main process with safeStorage and guarded IPC.
// IMPORTANT: Never log or expose API keys in console or analytics.

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export interface SettingsState {
  // Provider configurations (in-memory only)
  providers: ProvidersConfigMap;

  // Optional general settings bag (persisted via IPC when present)
  general?: Record<string, unknown>;

  // UI state
  isSettingsOpen: boolean;
  activeTab: string;

  // connection test statuses keyed by provider
  testResults: Record<ProviderName, TestStatus>;

  // Actions
  openSettings: () => void;
  closeSettings: () => void;
  setActiveTab: (tab: string) => void;
  updateProvider: (provider: ProviderName, partial: Partial<ProviderConfig>) => void;
  testConnection: (provider: ProviderName) => Promise<void>;

  // Lifecycle
  saveSettings: () => Promise<boolean>;
  loadSettings: () => Promise<void>;
}

const defaultProvider = (): ProviderConfig => ({
  enabled: false,
  apiKey: '',
  model: undefined,
  baseUrl: undefined,
});

const DEFAULT_PROVIDERS: ProvidersConfigMap = {
  claude: defaultProvider(),
  openai: defaultProvider(),
  gemini: defaultProvider(),
};

const DEFAULT_TEST_RESULTS: Record<ProviderName, TestStatus> = {
  claude: 'idle',
  openai: 'idle',
  gemini: 'idle',
};

// Factory function to create the store
const createSettingsStore = () => {
  console.log('[SettingsStore] Creating new store instance');
  
  return create<SettingsState>((set, get) => ({
    // State
    providers: { ...DEFAULT_PROVIDERS },
    isSettingsOpen: false,
    activeTab: 'api-keys',
    testResults: { ...DEFAULT_TEST_RESULTS },

    // Actions
    openSettings: () => {
      console.log('[SettingsStore] openSettings called');
      console.log('[SettingsStore] Current state before open:', get());
      
      set((state) => {
        console.log('[SettingsStore] Setting isSettingsOpen to true');
        const newState = { ...state, isSettingsOpen: true };
        console.log('[SettingsStore] New state after open:', newState);
        return newState;
      });
      
      // Verify the state was actually set
      setTimeout(() => {
        const currentState = get();
        console.log('[SettingsStore] State after setTimeout:', currentState);
        console.log('[SettingsStore] isSettingsOpen is now:', currentState.isSettingsOpen);
      }, 0);
    },
    
    closeSettings: () => {
      console.log('[SettingsStore] closeSettings called');
      set((state) => {
        console.log('[SettingsStore] Setting isSettingsOpen to false');
        return { ...state, isSettingsOpen: false };
      });
    },
    
    setActiveTab: (tab: string) => set({ activeTab: tab }),

    updateProvider: (provider: ProviderName, partial: Partial<ProviderConfig>) =>
      set((state) => {
        const current = state.providers[provider] ?? defaultProvider();
        // Never log secrets (api keys) here or elsewhere.
        const merged: ProviderConfig = {
          ...current,
          ...partial,
        };
        return {
          providers: {
            ...state.providers,
            [provider]: merged,
          },
        };
      }),

    testConnection: async (provider: ProviderName) => {
      const state = get();
      const config = state.providers[provider];
      if (!config || !config.apiKey) return;

      set((s) => ({
        testResults: { ...s.testResults, [provider]: 'testing' },
      }));

      try {
        const result = await window.electronAPI.testConnection({ provider, config });
        set((s) => ({
          testResults: {
            ...s.testResults,
            [provider]: result.success ? 'success' : 'error',
          },
        }));
      } catch {
        set((s) => ({
          testResults: { ...s.testResults, [provider]: 'error' },
        }));
      }
    },

    saveSettings: async () => {
      const state = get();
      try {
        const result = await window.electronAPI.saveSettings({
          providers: state.providers,
          general: state.general ?? {} // retain or add general settings if present
        });
        return result.success;
      } catch {
        console.error('Failed to save settings');
        return false;
      }
    },

    loadSettings: async () => {
      try {
        const settings = await window.electronAPI.loadSettings();
        if (settings && settings.providers) {
          set({
            providers: settings.providers,
            general: settings.general ?? get().general,
            testResults: DEFAULT_TEST_RESULTS,
            activeTab: 'api-keys',
          });
        }
      } catch {
        // Use defaults on error
        set({
          providers: { ...DEFAULT_PROVIDERS },
          testResults: { ...DEFAULT_TEST_RESULTS },
          activeTab: 'api-keys',
        });
      }
    },
  }));
};

// Singleton guard: ensure only one instance exists regardless of import paths
declare global {
  var __settingsStore: ReturnType<typeof createSettingsStore> | undefined;
}

// Check if we already have a store instance
if (globalThis.__settingsStore) {
  console.log('[SettingsStore] Using existing singleton instance');
} else {
  console.log('[SettingsStore] Creating new singleton instance');
}

export const useSettingsStore = globalThis.__settingsStore ?? (globalThis.__settingsStore = createSettingsStore());

// Additional debugging - log every time someone accesses the store
console.log('[SettingsStore] Store export accessed, store instance created');