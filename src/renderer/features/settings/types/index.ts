// Types for settings feature (Phase 1 scaffolding)

// Provider identifiers supported in Phase 1
export type ProviderName = 'claude' | 'openai' | 'gemini';

// Minimal provider configuration shape for store usage.
// Do NOT log secrets. TODO: Phase 2/3 - move secrets to main process with Electron safeStorage and IPC.
export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// Mapping of provider name to configuration (all optional entries).
export type ProvidersConfigMap = Partial<Record<ProviderName, ProviderConfig>>;