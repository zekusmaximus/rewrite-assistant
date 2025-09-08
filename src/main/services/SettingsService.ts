import { safeStorage, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as https from 'https';

type ProviderName = 'claude' | 'openai' | 'gemini';

interface ProviderConfig {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

interface Settings {
  providers: {
    claude: ProviderConfig;
    openai: ProviderConfig;
    gemini: ProviderConfig;
  };
  general: {
    autoSave: boolean;
    autoAnalyze: boolean;
    theme: string;
  };
}

class SettingsService {
  private settingsPath: string;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }

  private getDefaultSettings(): Settings {
    return {
      providers: {
        claude: { enabled: false, apiKey: '', model: 'claude-3-opus-20240229' },
        openai: { enabled: false, apiKey: '', model: 'gpt-4-turbo-preview' },
        gemini: { enabled: false, apiKey: '', model: 'gemini-pro' }
      },
      general: {
        autoSave: true,
        autoAnalyze: false,
        theme: 'light'
      }
    };
  }

  private async ensureDirExists(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    } catch {
      // ignore
    }
  }

  private base64ToBuffer(b64: string): Buffer {
    return Buffer.from(b64, 'base64');
  }

  private bufferToBase64(buf: Buffer): string {
    return buf.toString('base64');
  }

  private decryptIfNeeded(value: unknown): string {
    if (typeof value !== 'string' || !value) return '';
    if (!safeStorage.isEncryptionAvailable()) {
      // If encryption isn't available, we cannot decrypt; return as-is
      return value;
    }
    try {
      // Attempt to treat as base64-encoded encrypted string
      const buf = this.base64ToBuffer(value);
      return safeStorage.decryptString(buf);
    } catch {
      // If decryption fails, assume it was plaintext previously saved
      return value;
    }
  }

  private encryptIfAvailable(value: unknown): string {
    if (typeof value !== 'string' || !value) return '';
    if (!safeStorage.isEncryptionAvailable()) {
      // If encryption isn't available, persist plaintext (best effort)
      return value;
    }
    try {
      const enc = safeStorage.encryptString(value);
      return this.bufferToBase64(Buffer.from(enc));
    } catch {
      // If encryption fails unexpectedly, persist plaintext to avoid data loss
      return value;
    }
  }

  async loadSettings(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf-8');
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return this.getDefaultSettings();
      }

      const settings: Settings = {
        ...this.getDefaultSettings(),
        ...(parsed || {})
      };

      // Decrypt provider API keys if present
      try {
        const providers: Array<ProviderName> = ['claude', 'openai', 'gemini'];
        for (const p of providers) {
          const current = (settings.providers as any)[p];
          if (current && typeof current.apiKey === 'string' && current.apiKey) {
            current.apiKey = this.decryptIfNeeded(current.apiKey);
          }
        }
      } catch {
        // Do not throw or log secrets; fall back to defaults when catastrophic
      }

      return settings;
    } catch (err: any) {
      // If file missing or unreadable, return defaults
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return this.getDefaultSettings();
      }
      return this.getDefaultSettings();
    }
  }

  async saveSettings(settings: any): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureDirExists();

      // Create a shallow clone and ensure structure
      const toWrite: Settings = {
        ...this.getDefaultSettings(),
        ...(settings || {})
      };

      // Encrypt API keys if available
      try {
        const providers: Array<ProviderName> = ['claude', 'openai', 'gemini'];
        for (const p of providers) {
          const current = (toWrite.providers as any)[p];
          if (current && typeof current.apiKey === 'string' && current.apiKey) {
            current.apiKey = this.encryptIfAvailable(current.apiKey);
          }
        }
      } catch {
        // Continue; do not log secrets
      }

      await fs.writeFile(this.settingsPath, JSON.stringify(toWrite, null, 2), 'utf-8');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: String(error?.message || 'Failed to save settings') };
    }
  }

  // Lightweight fetch getter with safe fallbacks
  private async getFetch(): Promise<(input: any, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }>> {
    const g: any = globalThis as any;
    if (typeof g.fetch === 'function') {
      return g.fetch.bind(globalThis) as any;
    }
    // Minimal https-based fetch-like fallback (POST only in our usage)
    const httpsFetch = (input: string, init?: any) => {
      return new Promise<any>((resolve) => {
        try {
          const url = new URL(input);
          const opts: https.RequestOptions = {
            method: (init?.method || 'GET').toString(),
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + (url.search || ''),
            headers: init?.headers || {}
          };
          const req = https.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf-8');
              resolve({
                ok: res.statusCode! >= 200 && res.statusCode! < 300,
                status: res.statusCode || 0,
                text: async () => body,
                json: async () => {
                  try { return JSON.parse(body); } catch { return null; }
                }
              });
            });
          });
          req.on('error', () => {
            resolve({
              ok: false,
              status: 0,
              text: async () => '',
              json: async () => null
            });
          });
          if (init?.body) {
            const bodyData = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
            req.write(bodyData);
          }
          req.end();
        } catch {
          resolve({
            ok: false,
            status: 0,
            text: async () => '',
            json: async () => null
          });
        }
      });
    };
    return httpsFetch as any;
  }

  async testConnection(provider: string, config: any): Promise<{ success: boolean; error?: string }> {
    try {
      const p = String(provider || '').toLowerCase();
      if (!['claude', 'openai', 'gemini'].includes(p)) {
        return { success: false, error: 'Unsupported provider' };
      }
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid configuration' };
      }
      const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
      if (!apiKey) {
        return { success: false, error: 'Missing API key' };
      }

      const fetchImpl = await this.getFetch();

      if (p === 'claude') {
        const model = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : 'claude-3-opus-20240229';
        const base = typeof config.baseUrl === 'string' && /^https?:\/\//i.test(config.baseUrl) ? config.baseUrl.replace(/\/+$/, '') : 'https://api.anthropic.com';
        const url = `${base}/v1/messages`;
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }]
          })
        });
        if (!res.ok) {
          return { success: false, error: `HTTP ${res.status}` };
        }
        return { success: true };
      }

      if (p === 'openai') {
        const model = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : 'gpt-4-turbo-preview';
        const base = typeof config.baseUrl === 'string' && /^https?:\/\//i.test(config.baseUrl) ? config.baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
        const url = `${base}/chat/completions`;
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0
          })
        });
        if (!res.ok) {
          return { success: false, error: `HTTP ${res.status}` };
        }
        return { success: true };
      }

      // gemini
      {
        const model = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : 'gemini-pro';
        // Gemini typically uses fixed base; allow override if explicitly provided
        const base = typeof config.baseUrl === 'string' && /^https?:\/\//i.test(config.baseUrl)
          ? config.baseUrl.replace(/\/+$/, '')
          : 'https://generativelanguage.googleapis.com/v1beta';
        const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { parts: [{ text: 'ping' }] }
            ]
          })
        });
        if (!res.ok) {
          return { success: false, error: `HTTP ${res.status}` };
        }
        return { success: true };
      }
    } catch (error: any) {
      return { success: false, error: String(error?.message || 'Connection test failed') };
    }
  }
}

export default new SettingsService();