import { MissingKeyError, InvalidKeyError } from './errors/AIServiceErrors';
import { KeyGate, type ProviderShortName } from './KeyGate';

type ProviderConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

/**
 * Test double for KeyGate that simulates API key validation without making real IPC calls.
 * Used to make tests deterministic and avoid external dependencies.
 */
export class KeyGateTestDouble extends KeyGate {
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
  }

  override async requireKey(provider: ProviderShortName, options?: { validate?: boolean }): Promise<string> {
    const config = this.getMockProviderConfig(provider);

    const apiKey = (config?.apiKey || '').trim();
    if (!apiKey) {
      throw new MissingKeyError(provider);
    }

    if (options?.validate) {
      const isValid = await this.validateKeyDirect(provider, apiKey);
      if (!isValid) {
        throw new InvalidKeyError(provider, 'Key validation failed');
      }
    }

    return apiKey;
  }

  override async checkAllProviders(): Promise<{ hasWorkingProvider: boolean; workingProviders: ProviderShortName[] }> {
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

  private getMockProviderConfig(provider: ProviderShortName): ProviderConfig | null {
    const cfg = (this.mockSettings?.providers ?? {})[provider] as ProviderConfig | undefined;
    return cfg ?? null;
  }
}

export default KeyGateTestDouble;