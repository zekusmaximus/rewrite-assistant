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
      isEncryptionAvailable: () => true,
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
});