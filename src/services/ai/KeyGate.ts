// Centralized KeyGate with cached validation via secure preload IPC

import { MissingKeyError, InvalidKeyError } from './errors/AIServiceErrors';

export type ProviderShortName = 'claude' | 'openai' | 'gemini';

type ProviderConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

type HealthEntry = { valid: boolean; lastCheck: number };

export class KeyGate {
  private healthCache = new Map<string, HealthEntry>();
  private readonly HEALTH_CACHE_TTL = 30_000; // 30 seconds

  async requireKey(provider: ProviderShortName, options?: { validate?: boolean }): Promise<string> {
    const config = await this.getProviderConfig(provider);

    const apiKey = (config?.apiKey || '').trim();
    if (!apiKey) {
      throw new MissingKeyError(provider);
    }

    if (options?.validate) {
      const isValid = await this.validateKeyWithCache(provider, apiKey);
      if (!isValid) {
        throw new InvalidKeyError(provider, 'Key validation failed');
      }
    }

    return apiKey;
  }

  async checkAllProviders(): Promise<{ hasWorkingProvider: boolean; workingProviders: ProviderShortName[] }> {
    const providers: ProviderShortName[] = ['claude', 'openai', 'gemini'];
    const workingProviders: ProviderShortName[] = [];

    for (const p of providers) {
      try {
        await this.requireKey(p, { validate: true });
        workingProviders.push(p);
      } catch (err) {
        console.debug(`[KeyGate] Provider ${p} unavailable:`, err);
      }
    }

    return {
      hasWorkingProvider: workingProviders.length > 0,
      workingProviders,
    };
  }

  private async validateKeyWithCache(provider: ProviderShortName, apiKey: string): Promise<boolean> {
    const cacheKey = `${provider}:${apiKey.slice(-8)}`;
    const cached = this.healthCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.lastCheck < this.HEALTH_CACHE_TTL) {
      return cached.valid;
    }

    const isValid = await this.validateKeyDirect(provider, apiKey);
    this.healthCache.set(cacheKey, { valid: isValid, lastCheck: now });
    return isValid;
  }

  async validateKeyDirect(provider: ProviderShortName, apiKey: string): Promise<boolean> {
    try {
      // Use secure main-process connection test; avoids exposing secrets in renderer logs
      const result = await this.safeTestConnection(provider, { apiKey });
      return Boolean(result?.success);
    } catch {
      return false;
    }
  }

  // --------- IPC helpers ---------

  private async getProviderConfig(provider: ProviderShortName): Promise<ProviderConfig | null> {
    try {
      const settings = await this.safeLoadSettings();
      const cfg = (settings?.providers ?? {})[provider] as ProviderConfig | undefined;
      return cfg ?? null;
    } catch {
      return null;
    }
  }

  private async safeLoadSettings(): Promise<any | null> {
    try {
      return await (window as any)?.electronAPI?.loadSettings();
    } catch {
      return null;
    }
  }

  private async safeTestConnection(
    provider: ProviderShortName,
    config: Partial<ProviderConfig> & { apiKey: string }
  ): Promise<{ success: boolean; error?: string } | null> {
    try {
      return await (window as any)?.electronAPI?.testConnection({ provider, config });
    } catch {
      return null;
    }
  }
}

export default KeyGate;