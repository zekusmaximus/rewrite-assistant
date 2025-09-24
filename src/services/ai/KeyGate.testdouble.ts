import { MissingKeyError, InvalidKeyError } from './errors/AIServiceErrors';

export type ProviderShortName = 'claude' | 'openai' | 'gemini';

type ProviderConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

type HealthEntry = { valid: boolean; lastCheck: number };

/**
 * Test double for KeyGate that simulates API key validation without making real IPC calls.
 * Used to make tests deterministic and avoid external dependencies.
 */
export class KeyGateTestDouble {
  private healthCache = new Map<string, HealthEntry>();
  private readonly HEALTH_CACHE_TTL = 30_000; // 30 seconds
  private mockSettings: any = { providers: {} };
  private mockConnectionResults: Map<string, { success: boolean; error?: string }> = new Map();

  /**
   * Configure mock settings to be returned by loadSettings
   */
  setMockSettings(settings: any): void {
    this.mockSettings = settings || { providers: {} };
  }

  /**
   * Configure mock connection test results for specific providers
   */
  setMockConnectionResult(provider: ProviderShortName, result: { success: boolean; error?: string }): void {
    this.mockConnectionResults.set(provider, result);
  }

  /**
   * Reset all mock configurations
   */
  reset(): void {
    this.mockSettings = { providers: {} };
    this.mockConnectionResults.clear();
    this.healthCache.clear();
  }

  async requireKey(provider: ProviderShortName, options?: { validate?: boolean }): Promise<string> {
    const config = this.getProviderConfig(provider);

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
        console.debug(`[KeyGateTestDouble] Provider ${p} unavailable:`, err);
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
      // Use mock connection test instead of real IPC call
      const mockResult = this.mockConnectionResults.get(provider);
      if (mockResult !== undefined) {
        return mockResult.success;
      }

      // Default behavior: consider key valid if it starts with 'sk-' or 'test-'
      return apiKey.startsWith('sk-') || apiKey.startsWith('test-') || apiKey.length > 20;
    } catch {
      return false;
    }
  }

  // --------- Mock helpers ---------

  private getProviderConfig(provider: ProviderShortName): ProviderConfig | null {
    const cfg = (this.mockSettings?.providers ?? {})[provider] as ProviderConfig | undefined;
    return cfg ?? null;
  }

  private async safeLoadSettings(): Promise<any | null> {
    // Return mock settings instead of making IPC call
    return this.mockSettings;
  }

  private async safeTestConnection(
    provider: ProviderShortName,
    _config: Partial<ProviderConfig> & { apiKey: string }
  ): Promise<{ success: boolean; error?: string } | null> {
    // Return mock connection result instead of making IPC call
    const mockResult = this.mockConnectionResults.get(provider);
    return mockResult ?? null;
  }
}

export default KeyGateTestDouble;