# Performance Tuning Guide

This guide explains how the app routes requests across models, what metrics are tracked, and how to influence routing for reliability and cost management. The goals are consistent parsing, predictable latency, and clear upgrade paths for high‑stakes runs.

## Adaptive routing overview

Routing combines simple tier heuristics with live exponential‑moving‑average (EMA) metrics:
- Base tier selection by task complexity and type.
- Score computation per model and taskType using confidence, latency, and success EMAs with a small exploration factor.
- Confidence thresholds gate early acceptance; otherwise the system escalates to a stronger tier.

References:
- [ModelPerformanceTracker](src/services/ai/optimization/ModelPerformanceTracker.ts:78)
- [selectModel()](src/services/ai/AIServiceManager.ts:481)

Key helpers inside the manager:
- Task key derivation: [deriveTaskTypeKey()](src/services/ai/AIServiceManager.ts:450)
- Complexity check: [isComplex()](src/services/ai/AIServiceManager.ts:458)
- Confidence threshold: [confidenceThreshold()](src/services/ai/AIServiceManager.ts:469)

## Metrics and scoring

The tracker maintains EMAs per (modelId, taskType):
- Confidence: normalized to [0,1].
- Success rate: normalized to [0,1].
- Latency: inverse‑latency scoring favors faster models.

The final score combines accuracy and latency, with an optional cost penalty provided by the caller. See:
- [ModelPerformanceTracker.score()](src/services/ai/optimization/ModelPerformanceTracker.ts:150)

## Tiering and thresholds

Heuristics select candidate tiers:
- Fast/balanced for simple tasks.
- Strong/balanced for complex tasks or large contexts.

Acceptance rules:
- A response that meets or exceeds the confidence threshold for the given taskType and complexity is accepted immediately.
- Otherwise, the manager escalates up to a capped number of stronger attempts.

Routing and escalation occur in:
- [AIServiceManager.analyzeContinuity()](src/services/ai/AIServiceManager.ts:194)
- Model selection and scoring in [selectModel()](src/services/ai/AIServiceManager.ts:481)

## Tips for users

Influence routing with clear task labels and flags. These do not change cache identity or public types; they are used by heuristics:
- Set a stable taskType label (e.g., pronoun, timeline, character, continuity) and flags like complex or critical using:
  - [enrichAnalysisRequest()](src/services/ai/consensus/ConsensusAdapter.ts:76)

High‑stakes runs:
- For critical flows (detectors or rewriting), enable consensus:
  - [runAnalysisWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:109)
  - [runRewriteWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:167)
- Consensus increases reliability and should be used selectively to manage latency and cost.

Choosing a base model by task category:
- For a simple, category‑based default, see [selectModelForRequest()](src/services/ai/AIServiceManager.ts:107). Production routing should prefer EMA‑based [selectModel()](src/services/ai/AIServiceManager.ts:481) since it adapts to observed performance.

## Reliability posture

Targets for typical analyses:
- Sub‑5s median response for simple analysis types.
- High JSON parsing reliability via prompting contracts, schema alignment, and fallback repairs.
- Accuracy improvements are driven by prompting decisions, routing heuristics, and consensus (when marked critical).