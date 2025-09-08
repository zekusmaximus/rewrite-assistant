import { describe, it, expect } from 'vitest';
import { estimateTokensForModel, estimateMessageTokens, __TEST_ONLY__TOKENIZER_CONSTANTS } from '../Tokenizers';

function countAsciiNonAscii(s: string) {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x7f) ascii++;
    else nonAscii++;
  }
  return { ascii, nonAscii };
}

function heuristic(modelId: string, text: string): number {
  const m = String(modelId).toLowerCase();
  let divisor = 4.0;
  if (m.includes('claude') || m.includes('anthropic')) divisor = 3.5;
  else if (m.includes('gemini') || m.includes('google')) divisor = 3.2;

  const { ascii, nonAscii } = countAsciiNonAscii(text);
  const est = Math.round((ascii + 0.5 * nonAscii) / divisor);
  return Math.max(1, est);
}

describe('Tokenizers heuristic token estimation', () => {
  const openaiModel = 'gpt-4o';
  const claudeModel = 'claude-sonnet-4';
  const geminiModel = 'gemini-2-5-pro';

  it('estimates tokens for short ASCII strings consistently (OpenAI/Claude/Gemini)', () => {
    const s = 'Hello world!';
    expect(estimateTokensForModel(openaiModel, s)).toBe(heuristic(openaiModel, s));
    expect(estimateTokensForModel(claudeModel, s)).toBe(heuristic(claudeModel, s));
    expect(estimateTokensForModel(geminiModel, s)).toBe(heuristic(geminiModel, s));
  });

  it('estimates tokens for medium ASCII strings consistently (OpenAI/Claude/Gemini)', () => {
    const s = 'The quick brown fox jumps over the lazy dog. '.repeat(8);
    expect(estimateTokensForModel(openaiModel, s)).toBe(heuristic(openaiModel, s));
    expect(estimateTokensForModel(claudeModel, s)).toBe(heuristic(claudeModel, s));
    expect(estimateTokensForModel(geminiModel, s)).toBe(heuristic(geminiModel, s));
  });

  it('handles non-ASCII strings with weighted heuristic', () => {
    const s = '你好，世界！Привет, мир! مرحبا بالعالم 🌍';
    // Just verify equals our deterministic heuristic for all families
    expect(estimateTokensForModel(openaiModel, s)).toBe(heuristic(openaiModel, s));
    expect(estimateTokensForModel(claudeModel, s)).toBe(heuristic(claudeModel, s));
    expect(estimateTokensForModel(geminiModel, s)).toBe(heuristic(geminiModel, s));
  });
});

describe('Tokenizers message overhead accounting', () => {
  it('adds small overhead per message and base overhead', () => {
    const model = 'gpt-4o';
    const parts = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Analyze this scene for continuity issues.' },
    ];

    const expected = estimateTokensForModel(model, parts[0].content)
      + estimateTokensForModel(model, parts[1].content)
      + __TEST_ONLY__TOKENIZER_CONSTANTS.BASE_OVERHEAD
      + (2 * __TEST_ONLY__TOKENIZER_CONSTANTS.OVERHEAD_PER_MESSAGE);

    expect(estimateMessageTokens(model, parts)).toBe(expected);
  });
});