// Pricing.ts
// Centralized model pricing table and cost estimation utilities.
// - No heavy dependencies.
// - Allows environment override via MODEL_PRICING_JSON (stringified map).
// - Conservative defaults for unknown models.

export type Currency = 'USD';

export interface ModelPricing {
  inputPer1k: number;   // USD per 1,000 input tokens
  outputPer1k: number;  // USD per 1,000 output tokens
  currency: Currency;
}

type PricingMap = Record<string, ModelPricing>;

// Base pricing table (conservative; easily updated)
// Notes (approximate market references as of 2025, rounded conservatively):
// - OpenAI GPT-4o family: input ~$0.005/1k, output ~$0.015/1k
// - GPT-4.x family: a bit higher; here we align to 4o defaults for simplicity
// - GPT-5 placeholder maps to 4o rates until official pricing is stable
// - Claude:
//   - 3.5 Haiku very low, Sonnet mid, Opus high (conservative placeholders)
// - Gemini 2.5 Pro similar to mid-tier rates
const BASE_TABLE: PricingMap = {
  // OpenAI family
  'gpt-4o':           { inputPer1k: 0.005, outputPer1k: 0.015, currency: 'USD' },
  'gpt-4o-mini':      { inputPer1k: 0.003, outputPer1k: 0.009,  currency: 'USD' },
  'gpt-4-turbo':      { inputPer1k: 0.01,  outputPer1k: 0.03,   currency: 'USD' },
  'gpt-4':            { inputPer1k: 0.03,  outputPer1k: 0.06,   currency: 'USD' },
  'gpt-5':            { inputPer1k: 0.005, outputPer1k: 0.015,  currency: 'USD' }, // placeholder -> 4o

  // Claude family
  'claude-3-5-haiku': { inputPer1k: 0.0008, outputPer1k: 0.004,  currency: 'USD' },
  'claude-sonnet-4':  { inputPer1k: 0.003,  outputPer1k: 0.015,  currency: 'USD' },
  'claude-opus-4-1':  { inputPer1k: 0.015,  outputPer1k: 0.075,  currency: 'USD' },

  // Gemini family
  'gemini-2-5-pro':   { inputPer1k: 0.0035, outputPer1k: 0.0105, currency: 'USD' },
};

// Default conservative pricing if model is unknown
const DEFAULT_PRICING: ModelPricing = { inputPer1k: 0.004, outputPer1k: 0.012, currency: 'USD' };

// Parse optional override from env: MODEL_PRICING_JSON = JSON.stringify({ "model-id": { inputPer1k, outputPer1k, currency } })
function readOverride(): PricingMap | null {
  const raw = typeof process !== 'undefined' ? (process.env?.MODEL_PRICING_JSON ?? '') : '';
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    // Defensive: ensure proper shape
    const out: PricingMap = {};
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue;
        const ip = (v as any).inputPer1k;
        const op = (v as any).outputPer1k;
        const cur = (v as any).currency ?? 'USD';
        if (Number.isFinite(ip) && Number.isFinite(op) && (cur === 'USD')) {
          out[String(k).toLowerCase()] = { inputPer1k: Number(ip), outputPer1k: Number(op), currency: cur };
        }
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function normalizeId(id: string): string {
  return String(id || '').trim().toLowerCase();
}

// Family heuristics when no direct match
function familyPricing(modelId: string): ModelPricing | null {
  const m = normalizeId(modelId);
  // OpenAI families
  if (m.includes('gpt-4o')) return BASE_TABLE['gpt-4o'];
  if (m.includes('gpt-4')) return BASE_TABLE['gpt-4-turbo'];
  if (m.includes('gpt-5')) return BASE_TABLE['gpt-5'];
  if (m.startsWith('gpt')) return BASE_TABLE['gpt-4o'];

  // Claude families
  if (m.includes('haiku')) return BASE_TABLE['claude-3-5-haiku'];
  if (m.includes('sonnet')) return BASE_TABLE['claude-sonnet-4'];
  if (m.includes('opus')) return BASE_TABLE['claude-opus-4-1'];
  if (m.includes('claude')) return BASE_TABLE['claude-sonnet-4'];

  // Gemini families
  if (m.includes('gemini') && m.includes('pro')) return BASE_TABLE['gemini-2-5-pro'];
  if (m.includes('gemini')) return BASE_TABLE['gemini-2-5-pro'];

  return null;
}

let cachedMergedTable: PricingMap | null = null;

function getMergedTable(): PricingMap {
  if (cachedMergedTable) return cachedMergedTable;
  const overrides = readOverride();
  cachedMergedTable = { ...BASE_TABLE };
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      cachedMergedTable[k] = v;
    }
  }
  return cachedMergedTable;
}

export function getModelPricing(modelId: string): ModelPricing {
  const id = normalizeId(modelId);
  const table = getMergedTable();
  if (table[id]) return table[id];
  const fam = familyPricing(id);
  if (fam) return fam;
  return DEFAULT_PRICING;
}

export function estimateCost(
  modelId: string,
  usage: { inputTokens: number; outputTokens?: number }
): { estimatedUSD: number; breakdown: { inputUSD: number; outputUSD: number } } {
  const pr = getModelPricing(modelId);
  const inTok = Math.max(0, Math.floor(usage.inputTokens || 0));
  const outTok = Math.max(0, Math.floor(usage.outputTokens || 0));
  const inputUSD = (inTok / 1000) * pr.inputPer1k;
  const outputUSD = (outTok / 1000) * pr.outputPer1k;
  const estimatedUSD = roundUSD(inputUSD + outputUSD);
  return {
    estimatedUSD,
    breakdown: {
      inputUSD: roundUSD(inputUSD),
      outputUSD: roundUSD(outputUSD),
    },
  };
}

function roundUSD(x: number): number {
  // Round to 6 decimals to avoid floating point noise but keep precision
  return Math.round(x * 1e6) / 1e6;
}