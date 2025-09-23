import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { ProviderConfig, ProviderName, ProvidersConfigMap } from '../types';
import { useAPIConfiguration } from '../hooks/useAPIConfiguration';
import KeyGate from '../../../../services/ai/KeyGate';
import { MissingKeyError, InvalidKeyError } from '../../../../services/ai/errors/AIServiceErrors';
import { useAIStatusStore } from '../../../stores/aiStatusStore';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

const StatusPill: React.FC<{ status: TestStatus }> = ({ status }) => {
  const styles = {
    idle: { backgroundColor: '#f3f4f6', color: '#374151' },
    testing: { backgroundColor: '#fef3c7', color: '#92400e' },
    success: { backgroundColor: '#d1fae5', color: '#065f46' },
    error: { backgroundColor: '#fee2e2', color: '#991b1b' },
  };
  const labels = {
    idle: 'Idle',
    testing: 'Testing…',
    success: 'Success',
    error: 'Error',
  };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: '500',
      ...styles[status]
    }}>
      {labels[status]}
    </span>
  );
};

// Enhanced ProviderSection with inline styles
const ProviderSection: React.FC<{
  title: string;
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  status?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, enabled, onToggleEnabled, status, children }) => {
  return (
    <section style={{
      backgroundColor: 'white',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '16px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: '600',
            color: '#111827',
            margin: 0
          }}>
            {title}
          </h3>
          {status && <div>{status}</div>}
        </div>
        
        {/* Enhanced Toggle Switch */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          gap: '8px'
        }}>
          <div 
            onClick={() => onToggleEnabled(!enabled)}
            style={{
              position: 'relative',
              width: '44px',
              height: '24px',
              backgroundColor: enabled ? '#2563eb' : '#d1d5db',
              borderRadius: '12px',
              transition: 'background-color 0.2s',
              cursor: 'pointer'
            }}
          >
            <div style={{
              position: 'absolute',
              top: '2px',
              left: enabled ? '22px' : '2px',
              width: '20px',
              height: '20px',
              backgroundColor: 'white',
              borderRadius: '10px',
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }} />
          </div>
          <span style={{
            fontSize: '14px',
            color: '#374151',
            fontWeight: enabled ? '600' : '400'
          }}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>

      {/* Form content */}
      <div style={{
        opacity: enabled ? 1 : 0.6
      }}>
        {children}
      </div>
    </section>
  );
};

// Enhanced APIKeyForm with inline styles
const APIKeyForm: React.FC<{
  apiKey: string;
  model?: string;
  baseUrl?: string;
  disabled?: boolean;
  isTesting?: boolean;
  modelOptions: string[];
  defaultModel: string;
  validationErrors?: { apiKey?: string; model?: string; baseUrl?: string };
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onTest: () => void;
}> = ({
  apiKey, model, baseUrl, disabled, isTesting, modelOptions, validationErrors,
  onApiKeyChange, onModelChange, onBaseUrlChange, onTest
}) => {
  const [showKey, setShowKey] = React.useState(false);

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: disabled ? '#f9fafb' : 'white',
    color: disabled ? '#9ca3af' : '#111827'
  };

  const buttonStyle = {
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* API Key */}
      <div>
        <label style={{
          display: 'block',
          fontSize: '14px',
          fontWeight: '500',
          color: '#374151',
          marginBottom: '4px'
        }}>
          API Key
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type={showKey ? 'text' : 'password'}
            style={inputStyle}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="Enter API key"
            disabled={disabled}
          />
          <button
            type="button"
            style={{
              ...buttonStyle,
              backgroundColor: '#f3f4f6',
              color: '#374151',
              border: '1px solid #d1d5db'
            }}
            onClick={() => setShowKey(!showKey)}
            disabled={disabled}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        {validationErrors?.apiKey && (
          <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>
            {validationErrors.apiKey}
          </p>
        )}
      </div>

      {/* Model and Base URL */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151',
            marginBottom: '4px'
          }}>
            Model
          </label>
          <select
            style={inputStyle}
            value={model || ''}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select a model</option>
            {modelOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {validationErrors?.model && (
            <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>
              {validationErrors.model}
            </p>
          )}
        </div>
        
        <div>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151',
            marginBottom: '4px'
          }}>
            Base URL (optional)
          </label>
          <input
            type="text"
            style={inputStyle}
            value={baseUrl || ''}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder="https://api.example.com"
            disabled={disabled}
          />
          {validationErrors?.baseUrl && (
            <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>
              {validationErrors.baseUrl}
            </p>
          )}
        </div>
      </div>

      {/* Test Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          style={{
            ...buttonStyle,
            backgroundColor: disabled ? '#9ca3af' : '#2563eb',
            color: 'white',
            border: 'none'
          }}
          onClick={onTest}
          disabled={disabled || isTesting || !!validationErrors?.apiKey}
        >
          {isTesting ? 'Testing…' : 'Test Connection'}
        </button>
      </div>
    </div>
  );
};

const ensureConfig = (cfg?: Partial<ProviderConfig>): ProviderConfig => ({
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

  console.log(`[ProviderBlock ${provider}] enabled:`, cfg.enabled, 'config:', cfg);

  const handleToggleEnabled = (enabled: boolean) => {
    console.log(`[ProviderBlock ${provider}] Toggle to:`, enabled);
    const next: Partial<ProviderConfig> = { enabled };
    if (enabled && !cfg.model) {
      next.model = defaultModel;
    }
    updateProvider(provider, next);
  };

  const handleTest = async () => {
    testConnection(provider);
    try {
      const cfgLatest = ensureConfig(useSettingsStore.getState().providers[provider]);
      const [result] = await Promise.all([
        runHookTest(provider, cfgLatest),
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
      enabled={cfg.enabled}
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
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning'; message: string } | null>(null);

  console.log('[SettingsModal] Rendering, isOpen:', isSettingsOpen, 'providers:', providers);

  useEffect(() => {
    if (isSettingsOpen) {
      loadSettings();
    }
  }, [isSettingsOpen, loadSettings]);

  // Compute validation errors locally
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
      await saveSettings();
      const eligible: ProvidersConfigMap = {};
      for (const name of PROVIDERS) {
        const cfg = ensureConfig(providers[name]);
        const errs = validationMap[name];
        if (cfg.enabled && isNonEmpty(cfg.apiKey) && !errs.apiKey && !errs.model) {
          eligible[name] = cfg;
        }
      }
      await configureProviders(eligible);
    }, 600);
    return () => clearTimeout(timer);
  }, [providers, saveSettings, configureProviders, validationMap]);

  // Lock background scroll while the modal is open
  useEffect(() => {
    if (!isSettingsOpen) return;
    document.body.classList.add('overflow-hidden');
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isSettingsOpen]);

  // Close on Escape (only while open)
  useEffect(() => {
    if (!isSettingsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isSettingsOpen, closeSettings]);
  
  // Clear feedback banner when modal is closed
  useEffect(() => {
    if (!isSettingsOpen) {
      setFeedback(null);
    }
  }, [isSettingsOpen]);
  
  const handleSave = async () => {
    const keyGate = new KeyGate();
    setGeneralError(null);
    try {
      // Persist current settings first
      const success = await saveSettings();
      if (!success) {
        throw new Error('Failed to save settings');
      }
  
      // Validate providers using KeyGate; classify specific errors when possible
      const health = await keyGate.checkAllProviders();
      if (!health.hasWorkingProvider) {
        // Attempt to surface typed errors by probing each provider; first failure will bubble up
        await keyGate.requireKey('claude', { validate: true });
        await keyGate.requireKey('openai', { validate: true });
        await keyGate.requireKey('gemini', { validate: true });
        // If none threw a typed error (unlikely), fallback
        throw new Error('At least one working AI provider required');
      }
  
      // Configure eligible providers
      const eligible: ProvidersConfigMap = {};
      for (const name of PROVIDERS) {
        const cfg = ensureConfig(providers[name]);
        const errs = validationMap[name];
        if (cfg.enabled && isNonEmpty(cfg.apiKey) && !errs.apiKey && !errs.model) {
          eligible[name] = cfg;
        }
      }
      await configureProviders(eligible);
  
      // Revalidate AI status and provide inline feedback (debounced; never throws)
      await useAIStatusStore.getState().checkStatus();
      const { status } = useAIStatusStore.getState();
      if (status.available) {
        setFeedback({ type: 'success', message: 'AI services now active' });
      } else {
        setFeedback({ type: 'warning', message: 'Settings saved, but AI services are not available yet.' });
      }
  
      // Close modal on successful save as before
      closeSettings();
    } catch (error) {
      if (error instanceof MissingKeyError) {
        setGeneralError(error.userMessage);
      } else if (error instanceof InvalidKeyError) {
        setGeneralError(error.userMessage);
      } else {
        setGeneralError('Unknown configuration error');
      }
    }
  };

  if (!isSettingsOpen) {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      {/* Modal panel */}
      <div style={{
        position: 'relative',
        zIndex: 1100,
        backgroundColor: 'white',
        borderRadius: '12px',
        width: 'min(900px, calc(100vw - 2rem))',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: '1px solid #e5e7eb'
        }}>
          <h2 id="settings-modal-title" style={{
            fontSize: '18px',
            fontWeight: '600',
            color: '#111827',
            margin: 0
          }}>
            Settings
          </h2>
          <button
            type="button"
            onClick={closeSettings}
            style={{
              fontSize: '24px',
              color: '#6b7280',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1
            }}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ padding: '16px 24px 0' }}>
          <div style={{
            display: 'inline-flex',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            overflow: 'hidden'
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('api-keys')}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: '500',
                backgroundColor: activeTab === 'api-keys' ? '#2563eb' : 'white',
                color: activeTab === 'api-keys' ? 'white' : '#374151',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              API Keys
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: '500',
                backgroundColor: activeTab === 'general' ? '#2563eb' : 'white',
                color: activeTab === 'general' ? 'white' : '#374151',
                border: 'none',
                borderLeft: '1px solid #e5e7eb',
                cursor: 'pointer'
              }}
            >
              General
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{
          padding: '24px',
          flex: 1,
          overflowY: 'auto'
        }}>
          {activeTab === 'api-keys' ? (
            <div>
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
            <div style={{
              fontSize: '14px',
              color: '#6b7280',
              padding: '32px',
              textAlign: 'center'
            }}>
              General settings will appear here. Coming soon.
            </div>
          )}
        </div>
 
        {/* Inline feedback banner */}
        {feedback ? (
          <div style={{ margin: '0 24px 12px' }}>
            <div style={{
              border: feedback.type === 'success' ? '1px solid #86efac' : '1px solid #fcd34d',
              backgroundColor: feedback.type === 'success' ? '#f0fdf4' : '#fffbeb',
              color: feedback.type === 'success' ? '#065f46' : '#78350f',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '12px'
            }}>
              {feedback.message}
            </div>
          </div>
        ) : null}
 
        {/* Validation error (general) */}
        {generalError ? (
          <div style={{ margin: '0 24px 12px' }}>
            <div style={{ color: '#991b1b', backgroundColor: '#fee2e2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px' }}>
              {generalError}
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px'
        }}>
          <button
            type="button"
            onClick={closeSettings}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              backgroundColor: 'white',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'white',
              backgroundColor: '#2563eb',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;