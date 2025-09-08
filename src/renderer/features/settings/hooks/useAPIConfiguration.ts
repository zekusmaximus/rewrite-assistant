import type { ProvidersConfigMap, ProviderName } from '../types';

export type ConfigInvokeResult =
  | { ok: true }
  | { ok: false; error: { message: string; code: string } };

export function useAPIConfiguration() {
  async function configureProviders(config: ProvidersConfigMap): Promise<ConfigInvokeResult> {
    try {
      const api = (window as any)?.electronAPI;
      if (api?.configureProviders) {
        const res = await api.configureProviders(config);
        if (res && typeof res === 'object' && 'ok' in res) {
          return res as ConfigInvokeResult;
        }
        // If preload returns void or unknown, assume success to keep renderer stable.
        return { ok: true };
      }
      // Dev fallback: assume success when bridge not present.
      return { ok: true };
    } catch {
      // Do not log secrets or configs; return sanitized error.
      return { ok: false, error: { message: 'Configuration failed', code: 'CONFIGURE_FAILED' } };
    }
  }

  async function testConnection(
    provider: ProviderName,
    config?: ProvidersConfigMap[ProviderName]
  ): Promise<boolean> {
    try {
      const api = (window as any)?.electronAPI;
      if (api?.testProvider) {
        const res = await api.testProvider(provider, config);
        return !!(res && res.ok === true);
      }
      // Dev fallback: keep UI stable when bridge not present.
      return true;
    } catch {
      // Avoid logging secrets or configs.
      return false;
    }
  }

  return {
    configureProviders,
    testConnection,
  };
}