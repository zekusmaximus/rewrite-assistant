// src/__tests__/integration/testUtils.ts
import AIServiceManager from '../../services/ai/AIServiceManager';
import KeyGateTestDouble from '../../services/ai/KeyGate.testdouble';

export async function setupRealAIForTesting(): Promise<AIServiceManager> {
  const keyGate = new KeyGateTestDouble();

  // Use test keys instead of requiring real environment variables
  const testKeys: Record<'claude' | 'openai' | 'gemini', string> = {
    claude: 'test-claude-key',
    openai: 'test-openai-key',
    gemini: 'test-gemini-key',
  };

  // Configure mock settings and connection results to simulate valid keys
  keyGate.setMockSettings({
    providers: {
      claude: { apiKey: testKeys.claude, model: 'claude-sonnet-4' },
      openai: { apiKey: testKeys.openai, model: 'gpt-5' },
      gemini: { apiKey: testKeys.gemini, model: 'gemini-2-5-pro' },
    },
  });

  keyGate.setMockConnectionResult('claude', { success: true });
  keyGate.setMockConnectionResult('openai', { success: true });
  keyGate.setMockConnectionResult('gemini', { success: true });

  const manager = new AIServiceManager();
  manager.configure({
    claude: { apiKey: testKeys.claude, model: 'claude-sonnet-4' },
    openai: { apiKey: testKeys.openai, model: 'gpt-5' },
    gemini: { apiKey: testKeys.gemini, model: 'gemini-2-5-pro' },
  });

  return manager;
}