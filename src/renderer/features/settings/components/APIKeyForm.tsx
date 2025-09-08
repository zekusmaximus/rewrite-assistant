import React, { useState } from 'react';

interface ValidationErrors {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

interface APIKeyFormProps {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  disabled?: boolean;
  isTesting?: boolean;
  // New props
  modelOptions: string[];
  defaultModel: string;
  validationErrors?: ValidationErrors;
  isApiKeyValid?: boolean;

  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onTest: () => void;
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';

const inputErrorClass =
  'w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500';

const primaryButtonClass =
  'px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed';

const neutralButtonClass =
  'px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed';

const errorTextClass = 'mt-1 text-xs text-red-600';

const APIKeyForm: React.FC<APIKeyFormProps> = ({
  apiKey,
  model,
  baseUrl,
  disabled,
  isTesting,
  modelOptions,
  defaultModel,
  validationErrors,
  isApiKeyValid,
  onApiKeyChange,
  onModelChange,
  onBaseUrlChange,
  onTest,
}) => {
  const [showKey, setShowKey] = useState(false);

  // Accessible IDs for errors
  const apiKeyErrId = 'api-key-error';
  const modelErrId = 'model-error';
  const baseUrlErrId = 'base-url-error';

  const apiKeyHasError = !!validationErrors?.apiKey;
  const modelHasError = !!validationErrors?.model;
  const baseUrlHasError = !!validationErrors?.baseUrl;

  const testDisabled = !!disabled || !!isTesting || !!validationErrors?.apiKey;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="api-key-input">
          API Key
        </label>
        <div className="flex gap-2">
          <input
            id="api-key-input"
            type={showKey ? 'text' : 'password'}
            className={apiKeyHasError ? inputErrorClass : inputClass}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="Enter API key"
            disabled={disabled}
            autoComplete="off"
            aria-invalid={apiKeyHasError}
            aria-describedby={apiKeyHasError ? apiKeyErrId : undefined}
          />
          <button
            type="button"
            className={neutralButtonClass}
            onClick={() => setShowKey((v) => !v)}
            disabled={disabled}
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
            title={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        {apiKeyHasError ? <p id={apiKeyErrId} className={errorTextClass}>{validationErrors?.apiKey}</p> : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="model-select">
            Model
          </label>
          <select
            id="model-select"
            className={modelHasError ? inputErrorClass : inputClass}
            value={model ?? ''}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled}
            aria-invalid={modelHasError}
            aria-describedby={modelHasError ? modelErrId : undefined}
          >
            <option value="">Select a model</option>
            {modelOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {modelHasError ? <p id={modelErrId} className={errorTextClass}>{validationErrors?.model}</p> : null}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="base-url-input">
            Base URL (optional)
          </label>
          <input
            id="base-url-input"
            type="text"
            className={baseUrlHasError ? inputErrorClass : inputClass}
            value={baseUrl ?? ''}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder="https://api.example.com"
            disabled={disabled}
            autoComplete="off"
            aria-invalid={baseUrlHasError}
            aria-describedby={baseUrlHasError ? baseUrlErrId : undefined}
          />
          {baseUrlHasError ? <p id={baseUrlErrId} className={errorTextClass}>{validationErrors?.baseUrl}</p> : null}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={onTest}
          disabled={testDisabled}
          aria-disabled={testDisabled}
        >
          {isTesting ? 'Testing…' : 'Test Connection'}
        </button>
      </div>
    </div>
  );
};

export default APIKeyForm;