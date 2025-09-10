// Tokenizers.ts
// Pure utilities for token estimation with optional dynamic tokenizer support.
// - No hard dependency on tokenizer libraries; best-effort dynamic import attempted without logging.
// - Deterministic outputs for the same inputs (no randomness).
//
// Encoding notes (OpenAI):
// - GPT-3.5/4/4o/gpt-* typically use cl100k_base; o-series may use o200k_base where available.
// - We map broadly and fall back to heuristics if encodings/libs are unavailable.
//
// Claude/Gemini:
// - No official JS tokenizer readily available; we approximate with chars-per-token heuristics when dynamic libs aren't present.
//
// Heuristic fallback (used if tokenizer not available):
//   tokens = max(1, round((asciiLen + 0.5*nonAsciiCount) / divisor))
//   divisors by provider/model family:
//     - OpenAI: 4.0
//     - Claude: 3.5
//     - Gemini: 3.2

type MessageLike = { role?: string; content: string };

// Small overhead configuration for chat-like messages
const OVERHEAD_PER_MESSAGE = 4;
const BASE_OVERHEAD = 2;

function normalizeModelId(modelId: string): string {
  return String(modelId || '').toLowerCase().trim();
}

function modelFamily(modelId: string): 'openai' | 'anthropic' | 'google' | 'unknown' {
  const m = normalizeModelId(modelId);
  if (m.includes('gpt-') || m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.includes('gemini') || m.includes('google')) return 'google';
  return 'unknown';
}

// Map model to preferred encoding id for js-tiktoken-like libs
function preferredEncodingName(modelId: string): 'cl100k_base' | 'o200k_base' | 'cl100k_base' {
  const m = normalizeModelId(modelId);
  // Heuristic mapping:
  // - Newer "o" and "4o" families prefer o200k_base when available.
  if (m.includes('o1') || m.includes('o3') || m.includes('4o')) return 'o200k_base';
  // Default OpenAI mapping
  return 'cl100k_base';
}

// Attempts to get a length function via dynamic import of a tokenizer library.
// Synchronous API; returns a function or null. We DO NOT await dynamic import.
// Future calls may benefit if the dynamic import has resolved by then.
let tiktokenModule: any | null = null;
let tiktokenTried = false;

function tryInitiateDynamicImport(): void {
  if (tiktokenTried) return;
  tiktokenTried = true;
  try {
    // Use non-literal dynamic specifiers so TypeScript doesn't try to resolve missing modules.
    const m1 = 'js-tiktoken';
     
    (import(m1 as any) as Promise<any>)
      .then((mod: any) => {
        tiktokenModule = mod;
      })
      .catch(() => {
        const m2 = '@dqbd/tiktoken';
         
        return (import(m2 as any) as Promise<any>)
          .then((mod: any) => {
            tiktokenModule = mod;
          })
          .catch(() => {});
      });
  } catch { /* empty */ }
}

// Get an encoder length function for a given model if the module has loaded.
function getEncoderLenIfReady(modelId: string): ((text: string) => number) | null {
  if (!tiktokenModule) return null;
  const encName = preferredEncodingName(modelId);
  try {
    // js-tiktoken exposes get_encoding(name)
    if (typeof tiktokenModule.get_encoding === 'function') {
      const enc = tiktokenModule.get_encoding(encName);
      if (enc && typeof enc.encode === 'function') {
        return (text: string) => {
          try {
            return enc.encode(text ?? '').length || 0;
          } finally {
            // Some encoders have a free() API; guard it if present
            if (typeof enc.free === 'function') {
              try { enc.free(); } catch { /* empty */ }
            }
          }
        };
      }
    }
    // @dqbd/tiktoken may expose encodingForModel(model)
    if (typeof tiktokenModule.encodingForModel === 'function') {
      const enc = tiktokenModule.encodingForModel(encName);
      if (enc && typeof enc.encode === 'function') {
        return (text: string) => enc.encode(text ?? '').length || 0;
      }
    }
  } catch { /* empty */ }
  return null;
}

function countAsciiAndNonAscii(s: string): { ascii: number; nonAscii: number } {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x7f) ascii++;
    else nonAscii++;
  }
  return { ascii, nonAscii };
}

function heuristicDivisor(modelId: string): number {
  switch (modelFamily(modelId)) {
    case 'openai':
      return 4.0;
    case 'anthropic':
      return 3.5;
    case 'google':
      return 3.2;
    default:
      return 4.0;
  }
}

function heuristicTokens(modelId: string, text: string): number {
  const divisor = heuristicDivisor(modelId);
  const { ascii, nonAscii } = countAsciiAndNonAscii(text ?? '');
  const estimate = Math.round((ascii + 0.5 * nonAscii) / divisor);
  return Math.max(1, estimate);
}

// Public API

export function estimateTokensForModel(modelId: string, text: string): number {
  // Lazy-start dynamic import without side effects outside of this function.
  tryInitiateDynamicImport();
  const encoderLen = getEncoderLenIfReady(modelId);
  if (encoderLen) {
    try {
      const n = encoderLen(text ?? '');
      if (Number.isFinite(n) && n > 0) return n;
    } catch { /* empty */ }
  }
  // Claude and Gemini: approximate via chars/token ratio when tokenizer is absent
  return heuristicTokens(modelId, text ?? '');
}

export function estimateMessageTokens(modelId: string, parts: Array<MessageLike>): number {
  const list = Array.isArray(parts) ? parts : [];
  let total = BASE_OVERHEAD;
  for (const p of list) {
    const content = p?.content ?? '';
    total += estimateTokensForModel(modelId, content) + OVERHEAD_PER_MESSAGE;
  }
  return Math.max(1, total | 0);
}

// Expose constants for tests (not side-effectful)
export const __TEST_ONLY__TOKENIZER_CONSTANTS = {
  OVERHEAD_PER_MESSAGE,
  BASE_OVERHEAD,
};