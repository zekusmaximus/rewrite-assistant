# Consensus and Validation

This document covers how outputs are validated, normalized, and (optionally) reconciled across multiple models for higher reliability on critical runs.

## Validation

Structured outputs are aligned to shared Zod schemas. Providers are instructed to return JSON‑only; the validator applies strict checks with fallback repairs and normalization when needed.

Core schema:
- [AnalysisResponseSchema](src/services/ai/schemas/ResponseSchemas.ts:27)
- Issue fields and enums:
  - [IssueTypeEnum](src/services/ai/schemas/ResponseSchemas.ts:3)
  - [SeverityEnum](src/services/ai/schemas/ResponseSchemas.ts:5)
  - [SpanSchema](src/services/ai/schemas/ResponseSchemas.ts:7)
  - [IssueSchema](src/services/ai/schemas/ResponseSchemas.ts:17)

Validator and normalization:
- [validateAndNormalize()](src/services/ai/utils/ResponseValidator.ts:742)
  - Extracts JSON from provider text (handles code fences, stray characters).
  - Attempts strict parsing; if that fails, uses targeted repairs (smart quotes, trailing commas, quoting keys).
  - Normalizes spans, strings, and evidence; clamps confidences to [0,1].
  - Fills missing confidences heuristically when allowed by the schema.

Notes:
- Provider‑specific envelopes are validated first:
  - OpenAI: [openAIChatSchema()](src/services/ai/utils/ResponseValidator.ts:238)
  - Claude: [anthropicSchema()](src/services/ai/utils/ResponseValidator.ts:253)
  - Gemini: [geminiSchema()](src/services/ai/utils/ResponseValidator.ts:268)

## Consensus

Use consensus for critical runs to improve reliability through multi‑model agreement and structured reconciliation.

Pipeline:
- [ValidationPipeline.runConsensus()](src/services/ai/validation/ValidationPipeline.ts:167)

How it works:
- Executes one or more model attempts (sequential in this implementation).
- Groups issues by a stable hash that considers type, severity, span bucket, and evidence presence:
  - [ValidationPipeline.hashIssue()](src/services/ai/validation/ValidationPipeline.ts:417)
- For each group:
  - Type: majority vote.
  - Severity: maximum by severity order with frequency tie‑break.
  - Span: most votes; on tie, narrowest span wins.
  - Explanation/evidence/suggested_fix: taken from the highest‑confidence contributor; evidence is deduped and capped.
  - Confidence: mean of contributors; +0.05 boost for multi‑model agreement; clamped to [0,1].
- Acceptance:
  - Include merged issue if votes/totalModels ≥ acceptThreshold (default 0.5).
- Summary:
  - Chosen from the highest‑confidence model’s summary.
- Top‑level confidence:
  - Mean of merged issue confidences.

Human‑in‑the‑loop triggers:
- Critical severity present.
- Any merged issue with confidence ≥ humanReviewThreshold (default 0.9).
- High variance across models’ confidences (stddev ≥ 0.25).
- Disagreement where models reported issues but no merged issues met the acceptance threshold.

## Renderer‑side adapters

Adapters provide small, local helpers to set task labels/flags and to run consensus for detectors and rewriting.

- Enrich requests with stable taskType labels and flags:
  - [enrichAnalysisRequest()](src/services/ai/consensus/ConsensusAdapter.ts:76)
- Run analysis with optional consensus for critical cases:
  - [runAnalysisWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:109)
- Run rewrite with optional consensus (reconciles on summary text):
  - [runRewriteWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:167)

## Configuration defaults and tradeoffs

Defaults:
- acceptThreshold: 0.5
- humanReviewThreshold: 0.9
- consensusCount: 2
- maxModels: 2

Tradeoffs:
- Latency and cost increase with additional model attempts.
- Use consensus for high‑stakes scenes and analyses, not for routine runs.
- Pair consensus with routing and strong prompting contracts to keep the number of attempts low while improving reliability.

## Marking a run as critical

Mark a run as critical to activate consensus in adapters:
- Pass critical: true when using the adapter APIs:
  - See [runAnalysisWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:109) and [runRewriteWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:167)
- For detectors/rewrite paths, set flags in the enriched request via [enrichAnalysisRequest()](src/services/ai/consensus/ConsensusAdapter.ts:76)

This integrates with routing: taskType labels and flags inform tier selection and confidence thresholds without changing cache identity.