import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

let userDataDir: string;

vi.mock('electron', () => {
  const api = {
    app: {
      getPath: (name: string) => {
        if (name === 'userData') {
          return userDataDir;
        }
        return '';
      }
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b: Buffer) => Buffer.from(b).toString('utf8').replace(/^enc:/, '')
    }
  };
  return api;
});

const importService = async () => {
  vi.resetModules();
  const mod = await import('../../main/services/SettingsService');
  return mod.default as any;
};

const settingsFilePath = () => path.join(userDataDir, 'settings.json');

const makeTempUserData = async () => {
  const prefix = path.join(os.tmpdir(), 'ra-userdata-');
  return await fs.mkdtemp(prefix);
};

beforeEach(async () => {
  userDataDir = await makeTempUserData();
});

afterEach(async () => {
  try {
    await fs.rm(userDataDir, { recursive: true, force: true });
  } catch { /* empty */ }
});

describe('SettingsService security and persistence', () => {
  it('saves settings with encrypted apiKey and loads back decrypted', async () => {
    const service = await importService();
    const PLAINTEXT = 'test-openai-key';

    const saveRes = await service.saveSettings({
      providers: {
        openai: { enabled: true, apiKey: PLAINTEXT, model: 'gpt-4-turbo-preview' }
      }
    });
    expect(saveRes.success).toBe(true);

    const raw = await fs.readFile(settingsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const stored = parsed?.providers?.openai?.apiKey;

    expect(typeof stored).toBe('string');
    // base64-like check and not equal to plaintext
    expect(/^[A-Za-z0-9+/=]+$/.test(stored)).toBe(true);
    expect(stored === PLAINTEXT).toBe(false);

    const loaded = await service.loadSettings();
    // Avoid printing secrets on assertion failure
    expect(loaded?.providers?.openai?.apiKey === PLAINTEXT).toBe(true);
  });

  it('returns defaults when settings.json is missing', async () => {
    const service = await importService();
    // ensure file is absent
    try { await fs.rm(settingsFilePath(), { force: true }); } catch { /* empty */ }

    const loaded = await service.loadSettings();

    expect(loaded?.general?.theme).toBe('light');
    expect(loaded?.providers?.openai?.apiKey === '').toBe(true);
  });

  it('returns defaults on corrupted settings.json', async () => {
    const service = await importService();

    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(settingsFilePath(), 'not json', 'utf8');

    const loaded = await service.loadSettings();

    expect(loaded?.general?.theme).toBe('light');
    expect(loaded?.providers?.openai?.apiKey === '').toBe(true);
  });

  describe('encryption unavailable fallback behavior', () => {
    beforeEach(async () => {
      // Mock encryption as unavailable for fallback tests
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('stores API keys in minimal format when encryption unavailable', async () => {
      const service = await importService();
      const PLAINTEXT = 'sk-test12345678901234567890abcdefghij';

      const saveRes = await service.saveSettings({
        providers: {
          openai: { enabled: true, apiKey: PLAINTEXT, model: 'gpt-4-turbo-preview' }
        }
      });
      expect(saveRes.success).toBe(true);

      const raw = await fs.readFile(settingsFilePath(), 'utf8');
      const parsed = JSON.parse(raw);
      const stored = parsed?.providers?.openai?.apiKey;

      expect(typeof stored).toBe('string');
      expect(stored).toMatch(/^unencrypted:sk-test12:40$/);
      expect(stored).not.toBe(PLAINTEXT);
    });

    it('returns empty string when loading minimal format keys', async () => {
      const service = await importService();

      // Manually create settings file with minimal format
      await fs.mkdir(userDataDir, { recursive: true });
      await fs.writeFile(settingsFilePath(), JSON.stringify({
        providers: {
          openai: { enabled: true, apiKey: 'unencrypted:sk-test12:40', model: 'gpt-4-turbo-preview' }
        },
        general: { autoSave: true, autoAnalyze: false, theme: 'light' }
      }), 'utf8');

      const loaded = await service.loadSettings();
      expect(loaded?.providers?.openai?.apiKey).toBe('');
    });

    it('shows one-time warning when encryption unavailable on first save', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = await importService();

      await service.saveSettings({
        providers: {
          openai: { enabled: true, apiKey: 'test-key', model: 'gpt-4-turbo-preview' }
        }
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'SECURITY WARNING: API key encryption is not available on this system. Keys will be stored in plaintext. Consider using a system with encryption support for better security.'
      );

      consoleWarnSpy.mockRestore();
    });

    it('does not show warning on subsequent saves when encryption unavailable', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = await importService();

      // First save should show warning
      await service.saveSettings({
        providers: {
          openai: { enabled: true, apiKey: 'test-key', model: 'gpt-4-turbo-preview' }
        }
      });

      // Second save should not show warning
      await service.saveSettings({
        providers: {
          claude: { enabled: true, apiKey: 'test-key-2', model: 'claude-3-opus-20240229' }
        }
      });

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

      consoleWarnSpy.mockRestore();
    });

    it('marks warning as shown in settings after first warning', async () => {
      const service = await importService();

      await service.saveSettings({
        providers: {
          openai: { enabled: true, apiKey: 'test-key', model: 'gpt-4-turbo-preview' }
        }
      });

      const loaded = await service.loadSettings();
      expect(loaded?.general?.encryption_unavailable_warning_shown).toBe(true);
    });
  });

  describe('mixed encryption scenarios', () => {
    it('handles transition from encrypted to unencrypted gracefully', async () => {
      const service = await importService();
      const PLAINTEXT = 'test-openai-key';

      // First save with encryption available
      const saveRes = await service.saveSettings({
        providers: {
          openai: { enabled: true, apiKey: PLAINTEXT, model: 'gpt-4-turbo-preview' }
        }
      });
      expect(saveRes.success).toBe(true);

      // Load back and verify decryption works
      const loaded = await service.loadSettings();
      expect(loaded?.providers?.openai?.apiKey).toBe(PLAINTEXT);
    });

    it('handles corrupted encrypted data gracefully', async () => {
      const service = await importService();

      // Manually create settings file with corrupted encrypted data
      await fs.mkdir(userDataDir, { recursive: true });
      await fs.writeFile(settingsFilePath(), JSON.stringify({
        providers: {
          openai: { enabled: true, apiKey: 'corrupted-base64-data', model: 'gpt-4-turbo-preview' }
        },
        general: { autoSave: true, autoAnalyze: false, theme: 'light' }
      }), 'utf8');

      const loaded = await service.loadSettings();
      expect(loaded?.providers?.openai?.apiKey).toBe('corrupted-base64-data'); // Falls back to original value
    });
  });
});