// Simple test script to verify SettingsService functionality
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Mock electron module
const mockElectron = {
  app: {
    getPath: (name) => {
      if (name === 'userData') {
        return path.join(os.tmpdir(), 'test-rewrite-assistant');
      }
      return '';
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false, // Test fallback behavior
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^enc:/, '')
  }
};

// Mock globalThis
global.electron = mockElectron;
global.safeStorage = mockElectron.safeStorage;

// Import the SettingsService
async function testSettingsService() {
  try {
    // Create a temporary directory for testing
    const testDir = path.join(os.tmpdir(), 'test-rewrite-assistant');
    await fs.mkdir(testDir, { recursive: true });

    // Mock the module loading
    const module = require('./src/main/services/SettingsService.ts');
    const SettingsService = module.default;

    const service = new SettingsService();

    console.log('Testing SettingsService with encryption unavailable...');

    // Test 1: Save settings with API key
    const testKey = 'sk-test12345678901234567890abcdefghij';
    const saveResult = await service.saveSettings({
      providers: {
        openai: { enabled: true, apiKey: testKey, model: 'gpt-4-turbo-preview' }
      }
    });

    console.log('Save result:', saveResult);

    // Test 2: Load settings back
    const loaded = await service.loadSettings();
    console.log('Loaded API key:', loaded.providers.openai.apiKey);

    // Test 3: Check if warning was shown
    console.log('Warning shown flag:', loaded.general.encryption_unavailable_warning_shown);

    // Test 4: Save again to verify warning is not shown twice
    const saveResult2 = await service.saveSettings({
      providers: {
        claude: { enabled: true, apiKey: 'test-key-2', model: 'claude-3-opus-20240229' }
      }
    });

    console.log('Second save result:', saveResult2);

    console.log('All tests completed successfully!');

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testSettingsService();