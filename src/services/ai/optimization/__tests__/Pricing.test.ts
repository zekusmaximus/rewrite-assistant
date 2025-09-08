import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Pricing getModelPricing and estimateCost', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (process.env as any).MODEL_PRICING_JSON;
  });

  it('returns expected pricing for known models', async () => {
    const { getModelPricing } = await import('../Pricing');
    const p1 = getModelPricing('gpt-4o');
    expect(p1.currency).toBe('USD');
    expect(p1.inputPer1k).toBeCloseTo(0.005, 6);
    expect(p1.outputPer1k).toBeCloseTo(0.015, 6);

    const p2 = getModelPricing('claude-sonnet-4');
    expect(p2.inputPer1k).toBeGreaterThan(0);
    expect(p2.outputPer1k).toBeGreaterThan(0);

    const p3 = getModelPricing('gemini-2-5-pro');
    expect(p3.inputPer1k).toBeGreaterThan(0);
    expect(p3.outputPer1k).toBeGreaterThan(0);
  });

  it('estimateCost math is correct with known table', async () => {
    const { estimateCost } = await import('../Pricing');
    const res = estimateCost('gpt-4o', { inputTokens: 1000, outputTokens: 500 });
    // 1000 * 0.005 = 0.005; 500 * 0.015 = 0.0075; total = 0.0125
    expect(res.estimatedUSD).toBeCloseTo(0.0125, 6);
    expect(res.breakdown.inputUSD).toBeCloseTo(0.005, 6);
    expect(res.breakdown.outputUSD).toBeCloseTo(0.0075, 6);
  });

  it('falls back to conservative default for unknown modelId', async () => {
    const { getModelPricing } = await import('../Pricing');
    const p = getModelPricing('unknown-model-xyz');
    expect(p.currency).toBe('USD');
    expect(p.inputPer1k).toBeGreaterThan(0);
    expect(p.outputPer1k).toBeGreaterThan(0);
  });

  it('honors MODEL_PRICING_JSON env override (defensive parsing)', async () => {
    (process.env as any).MODEL_PRICING_JSON = JSON.stringify({
      'custom-model-x': { inputPer1k: 0.123, outputPer1k: 0.456, currency: 'USD' },
      // invalid entries ignored
      'bad': { foo: 1, bar: 2 },
    });
    const { getModelPricing, estimateCost } = await import('../Pricing');

    const p = getModelPricing('custom-model-x');
    expect(p.inputPer1k).toBeCloseTo(0.123, 6);
    expect(p.outputPer1k).toBeCloseTo(0.456, 6);

    const res = estimateCost('custom-model-x', { inputTokens: 2000, outputTokens: 1000 });
    // 2 * 0.123 + 1 * 0.456 = 0.702
    expect(res.estimatedUSD).toBeCloseTo(0.702, 6);
    expect(res.breakdown.inputUSD).toBeCloseTo(0.246, 6);
    expect(res.breakdown.outputUSD).toBeCloseTo(0.456, 6);
  });

  it('ignores malformed env JSON without throwing', async () => {
    (process.env as any).MODEL_PRICING_JSON = '{not-json';
    const { getModelPricing } = await import('../Pricing');
    const p = getModelPricing('gpt-4o'); // should use base table
    expect(p.inputPer1k).toBeCloseTo(0.005, 6);
  });
});