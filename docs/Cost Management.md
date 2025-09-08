# Cost Management

This guide explains how the app estimates tokens and USD costs, how budgets are enforced, and when batching can reduce duplicate work. Defaults are conservative, and budgets are off unless configured.

## Token estimation

Two estimators are used:
- Per‑string/token counting with model‑aware heuristics:
  - [estimateTokensForModel()](src/services/ai/utils/Tokenizers.ts:142)
- Chat‑style message aggregation with fixed overheads:
  - [estimateMessageTokens()](src/services/ai/utils/Tokenizers.ts:156)

Notes:
- The tokenizer tries dynamic imports when available, otherwise falls back to deterministic heuristics by provider family.
- Estimation is used before making requests to evaluate budgets and cost projections.

## Pricing and USD estimation

Pricing is centralized with a built‑in table and override support:
- Get model pricing:
  - [getModelPricing()](src/services/ai/optimization/Pricing.ts:110)
- Estimate USD given token usage:
  - [estimateCost()](src/services/ai/optimization/Pricing.ts:119)

Override pricing at runtime with a JSON map:
- Env: MODEL_PRICING_JSON
- Shape: { "model-id": { "inputPer1k": number, "outputPer1k": number, "currency": "USD" } }
- Example:
  {"gpt-5":{"inputPer1k":0.005,"outputPer1k":0.015,"currency":"USD"},"claude-sonnet-4":{"inputPer1k":0.003,"outputPer1k":0.015,"currency":"USD"}}

If a model is not in the table, the utility uses family heuristics or a conservative default.

## Budgets and trimming strategy

Budgets are optional and disabled unless explicitly set. When enabled, the provider enforces input budgets by trimming oldest previousScenes before the current scene:

- Enforcement and trimming:
  - [BaseProvider.enforceInputBudget()](src/services/ai/providers/BaseProvider.ts:174)

Behavior:
- Compute estimated input tokens for the request (scene + previous scenes).
- If over budget, drop the oldest previousScenes until the estimate fits.
- If HARD_FAIL_ON_BUDGET is true and the request still exceeds the budget, the provider throws; otherwise it proceeds with minimal context.

Session accounting is kept in‑memory for soft tracking.

## Optional batching utility

An optional utility consolidates duplicate analysis requests and limits concurrency. It is not wired into providers by default.

- Batch orchestration:
  - [batchAnalyze()](src/services/ai/optimization/RequestBatcher.ts:10)

Use cases:
- Deduplicate identical keys when analyzing multiple scenes with shared contexts.
- Limit local concurrency to stabilize latency and manage throughput.

## Environment variables

Defaults keep budgets off unless configured. All values are optional.

- MODEL_PRICING_JSON
  - Description: Override the built‑in pricing table with a JSON object.
  - Example:
    {"gpt-5":{"inputPer1k":0.005,"outputPer1k":0.015,"currency":"USD"}}
- MAX_INPUT_TOKENS_PER_REQUEST
  - Description: Soft cap on input tokens per request. Trims oldest previousScenes first.
  - Default: unset (no cap).
- MAX_OUTPUT_TOKENS_PER_REQUEST
  - Description: Reserved for future use; not strictly enforced in current providers.
  - Default: unset.
- MAX_TOKENS_PER_SESSION
  - Description: Session‑scoped soft accounting (informational).
  - Default: unset.
- HARD_FAIL_ON_BUDGET
  - Description: If 'true', throw when input still exceeds budget after best‑effort trimming.
  - Default: unset (treated as false).

## Practical guidance

- Start with budgets unset to focus on reliability; enable MAX_INPUT_TOKENS_PER_REQUEST as manuscripts grow.
- Use MODEL_PRICING_JSON to reflect negotiated rates or new models without a code change.
- Consider batching in high‑volume analysis workflows to avoid repeat work on identical inputs.