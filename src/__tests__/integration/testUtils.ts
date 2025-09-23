// src/__tests__/integration/testUtils.ts
import AIServiceManager from '../../services/ai/AIServiceManager';
import KeyGate from '../../services/ai/KeyGate';

export async function setupRealAIForTesting(): Promise<AIServiceManager> {
  const keyGate = new KeyGate();

  const requiredKeys: Record<'claude' | 'openai' | 'gemini', string | undefined> = {
    claude: process.env.CLAUDE_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };

  for (const [provider, key] of Object.entries(requiredKeys)) {
    if (!key) {
      throw new Error(`${provider.toUpperCase()}_API_KEY environment variable required for testing`);
    }
    // Best-effort validation; returns boolean and may use Electron IPC when available.
    // We intentionally do not assert true here to avoid flakiness in Node test env.
    await keyGate.validateKeyDirect(provider as 'claude' | 'openai' | 'gemini', key);
  }

  const manager = new AIServiceManager();
  manager.configure({
    claude: { apiKey: requiredKeys.claude!, model: 'claude-sonnet-4' },
    openai: { apiKey: requiredKeys.openai!, model: 'gpt-5' },
    gemini: { apiKey: requiredKeys.gemini!, model: 'gemini-2-5-pro' },
  });

  return manager;
}