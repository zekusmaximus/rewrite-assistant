// Types for settings feature (Phase 1 scaffolding)

// Provider identifiers supported in Phase 1
export type ProviderName = 'claude' | 'openai' | 'gemini';

// Minimal provider configuration shape for store usage.
// Do NOT log secrets.
export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// Mapping of provider name to configuration (all optional entries).
export type ProvidersConfigMap = Partial<Record<ProviderName, ProviderConfig>>;