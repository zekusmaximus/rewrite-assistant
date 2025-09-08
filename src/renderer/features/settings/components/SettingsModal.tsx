import React, { useEffect, useMemo } from 'react';
import ProviderSection from './ProviderSection';
import APIKeyForm from './APIKeyForm';
import { useSettingsStore } from '../stores';
import type { ProviderConfig, ProviderName, ProvidersConfigMap } from '../types';
import { useAPIConfiguration } from '../hooks/useAPIConfiguration';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

const StatusPill: React.FC<{ status: TestStatus }> = ({ status }) => {
  const map: Record<string, string> = {
    idle: 'bg-gray-100 text-gray-700',
    testing: 'bg-yellow-100 text-yellow-800',
    success: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
  };
  const labelMap: Record<string, string> = {
    idle: 'Idle',
    testing: 'Testing…',
    success: 'Success',
    error: 'Error',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status]}`}>
      {labelMap[status]}
    </span>
  );
};

const ensureConfig = (cfg?: { enabled: boolean; apiKey: string; model?: string; baseUrl?: string }) => ({
  enabled: cfg?.enabled ?? false,
  apiKey: cfg?.apiKey ?? '',
  model: cfg?.model,
  baseUrl: cfg?.baseUrl,
});

// Provider model options and defaults
const MODEL_OPTIONS: Record<ProviderName, string[]> = {
  claude: ['claude-sonnet-4', 'claude-opus-4-1', 'claude-haiku-4'],
  openai: ['gpt-5', 'gpt-4', 'gpt-4-turbo'],
  gemini: ['gemini-2-5-pro', 'gemini-pro', 'gemini-flash'],
};
const DEFAULT_MODEL: Record<ProviderName, string> = {
  claude: 'claude-sonnet-4',
  openai: 'gpt-5',
  gemini: 'gemini-2-5-pro',
};

type ValidationErrors = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

const PROVIDERS: ProviderName[] = ['claude', 'openai', 'gemini'];

// Validation helpers
function isNonEmpty(s?: string) {
  return !!s && !!s.trim();
}
function validateApiKey(provider: ProviderName, key: string): string | undefined {
  const k = key.trim();
  if (!k) return 'API key is required';
  const longEnough = /\S{20,}/.test(k);

  if (provider === 'claude') {
    const preferred = /^sk-ant-/.test(k);
    if (!preferred && !longEnough) return 'Invalid API key format';
    return undefined;
  }
  if (provider === 'openai') {
    const preferred = /^sk-/.test(k);
    if (!preferred && !longEnough) return 'Invalid API key format';
    return undefined;
  }
  if (provider === 'gemini') {
    const preferred = /^AIza/.test(k);
    if (!preferred && !longEnough) return 'Invalid API key format';
    return undefined;
  }
  return longEnough ? undefined : 'Invalid API key format';
}
function validateModel(model?: string): string | undefined {
  if (!model) return 'Model is required';
  return undefined;
}
function validateBaseUrl(url?: string): string | undefined {
  if (!isNonEmpty(url)) return undefined;
  const u = (url ?? '').trim();
  if (!/^https?:\/\//i.test(u)) return 'Base URL must start with http:// or https://';
  return undefined;
}

const ProviderBlock: React.FC<{
  provider: ProviderName;
  title: string;
  validationErrors: ValidationErrors;
  modelOptions: string[];
  defaultModel: string;
}> = ({ provider, title, validationErrors, modelOptions, defaultModel }) => {
  const { providers, updateProvider, testResults, testConnection } = useSettingsStore();
  const { testConnection: runHookTest } = useAPIConfiguration();
  const cfg = ensureConfig(providers[provider]);
  const status = testResults[provider];

  const handleToggleEnabled = (enabled: boolean) => {
    const next: Partial<ProviderConfig> = { enabled };
    if (enabled && !cfg.model) {
      next.model = defaultModel;
    }
    updateProvider(provider, next);
  };

  const handleTest = async () => {
    // Call store's test function to reflect "testing" (Phase 1 behavior)
    testConnection(provider);
    try {
      // Wait for mock to clear its 800ms reset, then set our own success/error
      const cfgLatest = ensureConfig(useSettingsStore.getState().providers[provider]);
      const [result] = await Promise.all([
        runHookTest(provider, cfgLatest as any),
        new Promise((r) => setTimeout(r, 850)),
      ]);
      useSettingsStore.setState((state) => ({
        testResults: { ...state.testResults, [provider]: result ? 'success' : 'error' },
      }));
    } catch {
      useSettingsStore.setState((state) => ({
        testResults: { ...state.testResults, [provider]: 'error' },
      }));
    } finally {
      setTimeout(() => {
        useSettingsStore.setState((state) => ({
          testResults: { ...state.testResults, [provider]: 'idle' },
        }));
      }, 1500);
    }
  };

  return (
    <ProviderSection
      title={title}
      enabled={!!cfg.enabled}
      onToggleEnabled={handleToggleEnabled}
      status={<StatusPill status={status} />}
    >
      <APIKeyForm
        apiKey={cfg.apiKey}
        model={cfg.model}
        baseUrl={cfg.baseUrl}
        disabled={!cfg.enabled}
        isTesting={status === 'testing'}
        modelOptions={modelOptions}
        defaultModel={defaultModel}
        validationErrors={validationErrors}
        onApiKeyChange={(value) => updateProvider(provider, { apiKey: value })}
        onModelChange={(value) => updateProvider(provider, { model: value || undefined })}
        onBaseUrlChange={(value) => updateProvider(provider, { baseUrl: value || undefined })}
        onTest={handleTest}
      />
    </ProviderSection>
  );
};

const SettingsModal: React.FC = () => {
  const { closeSettings, activeTab, setActiveTab, saveSettings, providers, isSettingsOpen, loadSettings } = useSettingsStore();
  const { configureProviders } = useAPIConfiguration();

  useEffect(() => {
    if (isSettingsOpen) {
      loadSettings();
    }
  }, [isSettingsOpen, loadSettings]);

  // Compute validation errors locally (do not store in Zustand)
  const validationMap: Record<ProviderName, ValidationErrors> = useMemo(() => {
    const res: Record<ProviderName, ValidationErrors> = {
      claude: {},
      openai: {},
      gemini: {},
    };
    for (const name of PROVIDERS) {
      const cfg = ensureConfig(providers[name]);
      if (!cfg.enabled) continue;
      // API key
      const keyErr = validateApiKey(name, cfg.apiKey ?? '');
      if (keyErr) res[name].apiKey = keyErr;
      // Model
      const modelErr = validateModel(cfg.model);
      if (modelErr) res[name].model = modelErr;
      // Base URL (optional)
      const urlErr = validateBaseUrl(cfg.baseUrl);
      if (urlErr) res[name].baseUrl = urlErr;
    }
    return res;
  }, [providers]);

  // Debounced auto-save and configure (600ms)
  useEffect(() => {
    const timer = setTimeout(async () => {
      // Save in-memory settings (placeholder)
      await saveSettings();
      // Build eligible provider map for configuration (enabled, key present, and no API/model errors)
      const eligible: ProvidersConfigMap = {};
      for (const name of PROVIDERS) {
        const cfg = ensureConfig(providers[name]);
        const errs = validationMap[name];
        if (cfg.enabled && isNonEmpty(cfg.apiKey) && !errs.apiKey && !errs.model) {
          eligible[name] = cfg as any;
        }
      }
      await configureProviders(eligible);
    }, 600);
    return () => clearTimeout(timer);
  }, [providers, saveSettings, configureProviders, validationMap]);

  const handleSave = async () => {
    const success = await saveSettings();
    if (success) {
      const eligible: ProvidersConfigMap = {};
      for (const name of PROVIDERS) {
        const cfg = ensureConfig(providers[name]);
        const errs = validationMap[name];
        if (cfg.enabled && isNonEmpty(cfg.apiKey) && !errs.apiKey && !errs.model) {
          eligible[name] = cfg as any;
        }
      }
      await configureProviders(eligible);
      closeSettings();
    } else {
      console.error('Failed to save settings');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 id="settings-modal-title" className="text-lg font-semibold text-gray-900">
            Settings
          </h2>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close settings"
            className="text-gray-500 hover:text-gray-700 focus:outline-none"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3">
          <div className="inline-flex rounded-md shadow-sm border border-gray-200 overflow-hidden" role="tablist" aria-label="Settings tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'api-keys'}
              onClick={() => setActiveTab('api-keys')}
              className={`px-4 py-2 text-sm font-medium focus:outline-none ${
                activeTab === 'api-keys'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              API Keys
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
              className={`px-4 py-2 text-sm font-medium focus:outline-none border-l border-gray-200 ${
                activeTab === 'general'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              General
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto">
          {activeTab === 'api-keys' ? (
            <div className="space-y-4">
              <ProviderBlock
                provider="claude"
                title="Claude (Anthropic)"
                modelOptions={MODEL_OPTIONS.claude}
                defaultModel={DEFAULT_MODEL.claude}
                validationErrors={validationMap.claude}
              />
              <ProviderBlock
                provider="openai"
                title="OpenAI"
                modelOptions={MODEL_OPTIONS.openai}
                defaultModel={DEFAULT_MODEL.openai}
                validationErrors={validationMap.openai}
              />
              <ProviderBlock
                provider="gemini"
                title="Gemini"
                modelOptions={MODEL_OPTIONS.gemini}
                defaultModel={DEFAULT_MODEL.gemini}
                validationErrors={validationMap.gemini}
              />
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              General settings will appear here. Coming soon.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeSettings}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;