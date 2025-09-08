import { create } from 'zustand';
import type { ProviderName, ProviderConfig, ProvidersConfigMap } from '../types';

// Phase 1: In-memory-only settings store. No persistence; no IPC.
// TODO(Phase 2/3): Integrate persistence via Electron main process with safeStorage and guarded IPC.
// IMPORTANT: Never log or expose API keys in console or analytics.

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export interface SettingsState {
  // Provider configurations (in-memory only)
  providers: ProvidersConfigMap;

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
  testConnection: (provider: ProviderName) => void;

  // Lifecycle (placeholders for Phase 1)
  saveSettings: () => Promise<boolean>;
  loadSettings: () => void;
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

export const useSettingsStore = create<SettingsState>((set, get) => ({
  // State
  providers: { ...DEFAULT_PROVIDERS },
  isSettingsOpen: false,
  activeTab: 'api-keys',
  testResults: { ...DEFAULT_TEST_RESULTS },

  // Actions
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => {
    // Phase 1: Close modal only. Data remains in-memory.
    // TODO(Phase 4): Consider clearing transient state and implementing a focus trap and escape-to-close handling.
    set({ isSettingsOpen: false });
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

  testConnection: (provider: ProviderName) => {
    // Phase 1: Simulate a short "testing" state and revert to idle.
    set((state) => ({
      testResults: { ...state.testResults, [provider]: 'testing' },
    }));
    setTimeout(() => {
      // Back to idle; no real network call in Phase 1.
      set((state) => ({
        testResults: { ...state.testResults, [provider]: 'idle' },
      }));
    }, 800);
  },

  saveSettings: async () => {
    // Phase 1: No persistence. Return success immediately.
    // TODO(Phase 2/3): Send sanitized config to main via IPC for secure storage with safeStorage.
    return true;
  },

  loadSettings: () => {
    // Phase 1: Initialize defaults (no persistence).
    set({
      providers: { ...DEFAULT_PROVIDERS },
      testResults: { ...DEFAULT_TEST_RESULTS },
      activeTab: 'api-keys',
    });
  },
}));