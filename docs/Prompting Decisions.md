# Prompting Decisions

This document explains why prompts are model-specific and how the app enforces deterministic, JSON-only outputs across providers. The focus is reliability and routing-friendly behavior, not variability.

Highlights
- Deterministic prompt layouts with temperature 0.2.
- Strict JSON-only output contracts aligned to shared schemas.
- Provider-native message shapes to minimize parsing errors and improve success rates.

## Claude (Anthropic)

Claude uses an XML-structured prompt with explicit sections for role, context, task, scene, an internal thinking block, and a final output_format that specifies the JSON contract. The provider adds a system instruction enforcing “ONLY valid JSON.”

References:
- [buildClaudePrompt()](src/services/ai/prompts/ClaudePrompts.ts:9)
- [ClaudeProvider.formatPrompt()](src/services/ai/providers/ClaudeProvider.ts:35)

Design notes:
- XML layout groups deterministic fields and encloses scene text in CDATA to avoid delimiter collisions.
- The thinking section requests silent chain-of-thought; users receive only the JSON object.
- The output_format block defines the exact JSON shape and forbids markdown or commentary.

## OpenAI

OpenAI uses a Markdown system message with few-shot guidance plus a user message containing normalized inputs. Structured outputs are requested via response_format using a strict JSON Schema.

References:
- [buildOpenAIPrompt()](src/services/ai/prompts/OpenAIPrompts.ts:44)
- [getOpenAIResponseFormat()](src/services/ai/prompts/OpenAIPrompts.ts:138)
- [OpenAIProvider.formatPrompt()](src/services/ai/providers/OpenAIProvider.ts:33)

Design notes:
- Few-shot examples demonstrate concise evidence and minimal spans.
- response_format enforces a schema aligned with the app’s Zod types to reduce repair work.
- The user message carries normalized reader context and previous scene metadata for stability.

## Gemini

Gemini uses a system instruction plus a parts array to separate inputs. The provider requests JSON-only via generationConfig.response_mime_type when supported.

References:
- [buildGeminiPrompt()](src/services/ai/prompts/GeminiPrompts.ts:48)
- [GeminiProvider.formatPrompt()](src/services/ai/providers/GeminiProvider.ts:44)

Design notes:
- Instruction lists role, reasoning steps, and a strict output structure.
- Inputs are provided as separate parts, including normalized reader knowledge and compact previous-scene metadata.

## Deterministic strings and strict JSON outputs

- Prompts normalize inputs (sorting sets, compact metadata) to produce stable strings across runs.
- Temperature is kept low to reduce variance in explanations and spans.
- All providers are instructed to return JSON only; downstream validation handles repairs if needed, but the prompting contracts aim to minimize that path.