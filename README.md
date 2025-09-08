# Rewrite Assistant

A desktop application that helps authors rewrite scenes after manually reordering them in their manuscript. The app now includes scene reordering, continuity issue detection, and AI‑powered rewriting with provider configuration.

## Current Status at a Glance

- ✅ Phase 1 — Core Scene Reordering: complete
- ✅ Phase 2 — Continuity Analysis: implemented (local detectors + optional AI assist)
- ✅ Phase 3 — AI Rewriting: implemented (single rewrite per scene, batch supported, no alternatives/ranking)
- 🚧 Phase 4 — Polish & Export UX: ongoing (export engine implemented; UI wiring in progress)

## Features

### Phase 1 — Core Scene Reordering (Completed)
- Load manuscripts: import .txt files and automatically parse them into scenes
- Visual scene list and content viewer
- Drag‑and‑drop reordering with moved‑scene indicators
- Undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z)
- Save current order back to a .txt file

### Phase 2 — Continuity Analysis (Implemented)
- Detect issues introduced by reordering, including:
  - Pronoun antecedent problems and ambiguities
  - Character introduction/alias issues
  - Timeline/temporal conflicts
  - Plot/context references to unseen events
  - Optional engagement checks for early scenes
- Local heuristics first; selective AI validation via configured providers
- Issues panel with inline highlighting and “Show in scene” navigation

### Phase 3 — AI Rewriting (Implemented)
- One rewrite per scene (no alternatives/ranking) focused on fixing detected issues only
- Rewrite Panel: per‑scene status, batch processing, progress and history
- Minimal diffs and change explanations; preserve author voice and story elements
- Batch rewrite moved scenes in narrative order with cancellation support

### Phase 4 — Polish and Export (In Progress)
- Export engine supports exporting original, rewritten, both, or change‑log formats
- Export dialog component exists and is covered by tests; UI entry point will be wired soon

## Installation

### From Package (Recommended)
1. Build installers (Windows, default):
   - Run the Make task to generate artifacts under `out/`.
2. Extract the generated `Rewrite Assistant-win32-x64` folder (or run the Squirrel installer if present).
3. Launch the `Rewrite Assistant` executable.

### From Source
1. Clone or download this repository
2. Install dependencies
3. Run in development mode
4. Build/package installers

Notes
- Node.js 18+ is required.
- Electron Forge with Vite is used for build and packaging.

## Usage

### Getting Started
1. Launch the application
2. Load a manuscript: click “Load Manuscript” and select a `.txt` file
   - Optional: place `manuscript.txt` in the working directory to auto‑load on start
3. Reorder scenes by dragging in the left panel; read content on the right
4. Find issues: click “🔍 Find Issues” (or press Ctrl/Cmd+Shift+A)
5. Open “Rewrite Panel” to generate rewrites for scenes with issues (single rewrite only)
6. Save reordered text with “Save” (export UI for rewrites will be wired next)

### Manuscript Format
The parser supports several patterns and falls back safely:
- Explicit scene markers: `[SCENE: CHxx_Syy ...]` (preferred)
- Chapter headers: `=== Chapter N ===` or `Chapter/CHAPTER N`
- Scene headers: `Scene/SCENE N`
- Scene break marker: `### SCENE BREAK ###`
- Fallback: double newlines

### Keyboard Shortcuts
- **Ctrl+Z** (Cmd+Z on Mac): Undo last reorder
- **Ctrl+Y** (Cmd+Y on Mac): Redo last undone reorder
- **Ctrl+Shift+Z** (Cmd+Shift+Z on Mac): Alternative redo
- **Ctrl+Shift+A** (Cmd+Shift+A on Mac): Open Issues panel and analyze moved scenes

### Interface Overview
- **Left Panel**: Scene list with drag-and-drop functionality
- **Right Panel**: Selected scene content viewer
- **Header**: File ops (New/Load/Save), Undo/Redo, Find Issues, Rewrite Panel, Settings
- **Status Indicators**: Shows moved scenes and total scene count
- **Issues Panel**: Bottom panel listing issues by type; jump to highlights
- **Rewrite Panel**: Right‑side management for per‑scene/batch rewrites

## Technical Details

### Built With
- Electron 32+ with Electron Forge + Vite
- React 18, TypeScript 5+, Tailwind CSS
- Zustand for state
- @atlaskit/pragmatic-drag-and-drop for DnD
- better-sqlite3 for durable caches (analysis)
- minisearch and compromise for lightweight NLP/search
- Vitest and Testing Library for tests

### Architecture
- Main: file dialogs, parsing, export, AI orchestration endpoints
- Preload: safe IPC bridges (`electronAPI`, minimal `ipcRenderer.invoke`)
- Renderer: React UI (reorder, issues, rewrite, settings)
- AI services: provider adapters, prompts, routing, pricing/cost, consensus
- Caching: prompt/analysis caches for speed and cost control

### File Structure
```
src/
├── main/           # Electron main process (IPC handlers, export)
├── renderer/       # React app (features: reorder, analyze, rewrite, settings)
│   ├── components/ # Shared UI
│   ├── features/   # Analyze/Reorder/Rewrite/Export/Settings
│   ├── stores/     # Zustand stores
│   └── src/        # App entry point
├── services/       # AI, caching, rewrite engine, export
└── shared/         # Shared types/constants
```

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup
Development scripts (npm):
- Install dependencies: install
- Start in dev (Forge/Vite): start
- Type check: lint
- Run unit tests: test (or test:watch)
- Package (no installer): package
- Make installers: make

### Project Structure
This project follows the strict guidelines outlined in the Rewrite Assistant Vision document:
- **NO** opening selection or optimization features
- **NO** automated scene ranking or scoring
- **FOCUS** on rewriting scenes for their new positions
- **TERMINOLOGY**: Uses "rewrite" not "optimize", "scenes" not "candidates"

## Sample Manuscript

A sample manuscript (`sample-manuscript.txt`) is included for testing. It contains 4 chapters that can be reordered to test the functionality.

## Provider Configuration (Settings)

Set up AI providers from the in‑app Settings dialog (⚙️ in the header):
- Enable one or more providers (Claude/Anthropic, OpenAI, Gemini)
- Paste your API key; pick a model; optional base URL
- Click Test to validate; Save to apply
Notes
- Keys are only used locally. Validation avoids logging secrets.
- The app routes to cost‑effective models first, escalating only as needed.

## Secure Settings Storage

- API keys are stored only in the Electron main process and encrypted using Electron safeStorage before persisting. See [safeStorage.encryptString()](src/main/services/SettingsService.ts:89) and [safeStorage.decryptString()](src/main/services/SettingsService.ts:75). The renderer interacts via IPC and never receives raw secrets.
- On disk, keys are stored encrypted (base64-encoded cipher text) under userData/settings.json. The path is resolved via [app.getPath('userData')](src/main/services/SettingsService.ts:32), where the service writes to `settings.json`.
- Manual verification:
  1) Open the app’s user data directory returned by [app.getPath('userData')](src/main/services/SettingsService.ts:32).
  2) Inspect the `settings.json` file and confirm `providers.*.apiKey` fields appear as base64 blobs (not plaintext).
  3) Use the Settings UI to run connection tests and Save; the file should continue to contain encrypted values.
- Permissions:
  - The settings file resides in Electron’s per-user app data directory. On POSIX, typical user directory permissions restrict other users by default; on Windows, user profile ACLs apply. Additional hardening may be added if needed.
- Migration:
  - First launch after an update may require re-entering keys; a missing or corrupted file is handled gracefully (defaults are returned without throwing).
## Troubleshooting

### Common Issues
1. **Application won't start**: Ensure all dependencies are installed with `npm install`
2. **Scenes not parsing correctly**: Check that your manuscript uses clear scene separators
3. **Drag-and-drop not working**: Try refreshing the application or reloading the manuscript
4. **Save not working**: Ensure you have write permissions to the target directory
5. **No AI models configured**: Open Settings and enter at least one valid API key

### Getting Help
This is a development version. For issues or questions:
1. Check the console for error messages (F12 in development mode)
2. Verify your manuscript format matches the supported patterns
3. Try with the included sample manuscript first

## License

MIT License - See LICENSE file for details

## Roadmap

### Phase 2: Continuity Analysis (Done; ongoing refinements)
- Pronoun, timeline, character, plot/context, and optional engagement checks
- Local + AI‑assisted pipeline with caching and selective consensus

### Phase 3: AI‑Powered Rewriting (Done; ongoing refinements)
- Single rewrite per scene, batch processing, history, and apply flow
- Minimal diffs and change explanations

### Phase 4: Polish & Export (In Progress)
- Wire export dialog into the main UI; richer diffs; performance polish
- Multiple manuscript sessions and advanced splitting options

---
## AI/LLM Capabilities (Overview)

Provider‑aware prompting, strict output validation, adaptive routing with performance tracking, optional consensus on critical runs, and cost/budget controls.

- Model‑specific prompting and output contracts
  - Claude: XML‑structured prompts; JSON‑only outputs
  - OpenAI: system + few‑shot; JSON Schema response_format
  - Gemini: instruction + parts; JSON‑only when supported
  - See: `src/services/ai/prompts/*`, `src/services/ai/providers/*`

- Validation and normalization
  - Zod schemas with fallback repairs and normalization of spans/strings/evidence
  - See: `src/services/ai/schemas/ResponseSchemas.ts`, `src/services/ai/utils/ResponseValidator.ts`

- Adaptive routing and performance
  - EMA of confidence/latency/success; threshold‑gated acceptance
  - See: `src/services/ai/optimization/ModelPerformanceTracker.ts`, `src/services/ai/AIServiceManager.ts`

- Consensus on critical runs
  - Multi‑model reconciliation for high‑stakes scenes
  - See: `src/services/ai/validation/ValidationPipeline.ts`, `src/services/ai/consensus/ConsensusAdapter.ts`

- Cost estimation and budgets
  - Token estimation, pricing tables with env override, and input budgets
  - See: `src/services/ai/optimization/Pricing.ts`, `src/services/ai/utils/Tokenizers.ts`, `src/services/ai/providers/BaseProvider.ts`

## Quickstart: Analysis and Rewrite Flows

Run the app:
1) npm install
2) npm start

Run tests:
1) npm test
2) For watch mode: npm run test:watch

Read these focused guides next:
- Prompting decisions: docs/Prompting Decisions.md
- Performance and routing: docs/Performance Tuning Guide.md
- Cost management and budgets: docs/Cost Management.md
- Consensus and validation: docs/Consensus and Validation.md

## Configuration Summary

Environment variables (conservative defaults; budgets are off unless set):

- MODEL_PRICING_JSON
  - Override the pricing table used by cost estimation.
  - Shape: {"model-id":{"inputPer1k":number,"outputPer1k":number,"currency":"USD"}}

- MAX_INPUT_TOKENS_PER_REQUEST
  - Soft cap on input tokens per request; if exceeded, trims oldest previousScenes before the current scene.
  - Enforced by BaseProvider.enforceInputBudget() in `src/services/ai/providers/BaseProvider.ts`

- MAX_OUTPUT_TOKENS_PER_REQUEST
  - Reserved for future use; not strictly enforced yet.

- MAX_TOKENS_PER_SESSION
  - Session‑scoped soft accounting (informational).

- HARD_FAIL_ON_BUDGET
  - If "true", throws when input still exceeds the budget after best‑effort trimming.

Optional batching for deduplication (not wired into providers by default):
- See `src/services/ai/optimization/RequestBatcher.ts`

Marking a run critical to activate consensus:
- Use renderer‑side adapters with critical: true, which trigger consensus reconciliation for high‑stakes scenes:
  - runAnalysisWithOptionalConsensus() and runRewriteWithOptionalConsensus() in `src/services/ai/consensus/ConsensusAdapter.ts`
- See docs/Consensus and Validation.md for details.

## Reliability Targets and Measurement

- JSON parsing reliability: JSON‑only outputs with fallback repairs and Zod normalization.
- Latency target: Sub‑5s typical response for simple analyses.
  - EMA‑based routing favors faster, reliable models under current conditions.
  - See: `src/services/ai/optimization/ModelPerformanceTracker.ts`
- Accuracy improvements: Driven by prompting decisions, routing heuristics, and consensus on critical runs rather than variability tuning.

## Further Reading

- Prompting Decisions: docs/Prompting Decisions.md
- Performance Tuning Guide: docs/Performance Tuning Guide.md
- Cost Management: docs/Cost Management.md
- Consensus and Validation: docs/Consensus and Validation.md
