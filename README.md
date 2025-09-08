# Rewrite Assistant

A desktop application that helps authors rewrite scenes after manually reordering them in their manuscript. This is Phase 1 of the complete Rewrite Assistant vision, focusing on core scene reordering functionality.

## Features

### ✅ Phase 1 - Core Scene Reordering (COMPLETED)
- **Load Manuscripts**: Import text files and automatically parse them into scenes
- **Visual Scene Management**: View all scenes in a clean, organized interface
- **Drag-and-Drop Reordering**: Easily reorder scenes by dragging them to new positions
- **Scene Content Viewer**: View and read individual scene content
- **Undo/Redo Support**: Full undo/redo functionality with keyboard shortcuts (Ctrl+Z/Ctrl+Y)
- **Save Reordered Manuscripts**: Export your reordered manuscript as a text file
- **Move Tracking**: Visual indicators show which scenes have been moved from their original positions

### 🚧 Future Phases (Not Yet Implemented)
- **Phase 2**: Continuity Analysis - Identify issues when scenes are moved
- **Phase 3**: AI-Powered Rewriting - Generate scene rewrites for new positions
- **Phase 4**: Advanced Features - Polish and reliability

## Installation

### From Package (Recommended)
1. Download the packaged application from the `out/` directory
2. Extract the `Rewrite Assistant-win32-x64` folder
3. Run the `Rewrite Assistant` executable

### From Source
1. Clone or download this repository
2. Install dependencies: `npm install`
3. Run in development mode: `npm start`
4. Package for distribution: `npm run package`

## Usage

### Getting Started
1. **Launch the Application**: Open Rewrite Assistant
2. **Load a Manuscript**: Click "Load Manuscript" and select a `.txt` file
3. **View Scenes**: Your manuscript will be automatically parsed into scenes
4. **Reorder Scenes**: Drag scenes up or down to reorder them
5. **Save Changes**: Click "Save" to export your reordered manuscript

### Manuscript Format
The application supports text files with scenes separated by:
- Chapter markers (e.g., "Chapter 1", "CHAPTER 2")
- Scene markers (e.g., "Scene 1", "SCENE 2")
- Scene break markers (e.g., "### SCENE BREAK ###")
- Double newlines (automatic fallback)

### Keyboard Shortcuts
- **Ctrl+Z** (Cmd+Z on Mac): Undo last reorder
- **Ctrl+Y** (Cmd+Y on Mac): Redo last undone reorder
- **Ctrl+Shift+Z** (Cmd+Shift+Z on Mac): Alternative redo

### Interface Overview
- **Left Panel**: Scene list with drag-and-drop functionality
- **Right Panel**: Selected scene content viewer
- **Header**: File operations and undo/redo controls
- **Status Indicators**: Shows moved scenes and total scene count

## Technical Details

### Built With
- **Electron 32+**: Cross-platform desktop framework
- **React 18**: Modern UI framework
- **TypeScript 5+**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Zustand**: Lightweight state management
- **@atlaskit/pragmatic-drag-and-drop**: Smooth drag-and-drop interactions

### Architecture
- **Main Process**: File operations and system integration
- **Renderer Process**: React-based user interface
- **IPC Communication**: Secure communication between processes
- **State Management**: Centralized state with history tracking

### File Structure
```
src/
├── main/           # Electron main process
├── renderer/       # React application
│   ├── components/ # Reusable UI components
│   ├── features/   # Feature-specific components
│   ├── stores/     # State management
│   └── src/        # App entry point
└── shared/         # Shared types and constants
```

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup
```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Type checking
npm run lint

# Package for distribution
npm run package

# Create distributable installers
npm run make
```

### Project Structure
This project follows the strict guidelines outlined in the Rewrite Assistant Vision document:
- **NO** opening selection or optimization features
- **NO** automated scene ranking or scoring
- **FOCUS** on rewriting scenes for their new positions
- **TERMINOLOGY**: Uses "rewrite" not "optimize", "scenes" not "candidates"

## Sample Manuscript

A sample manuscript (`sample-manuscript.txt`) is included for testing. It contains 4 chapters that can be reordered to test the functionality.

## Troubleshooting

### Common Issues
1. **Application won't start**: Ensure all dependencies are installed with `npm install`
2. **Scenes not parsing correctly**: Check that your manuscript uses clear scene separators
3. **Drag-and-drop not working**: Try refreshing the application or reloading the manuscript
4. **Save not working**: Ensure you have write permissions to the target directory

### Getting Help
This is a development version. For issues or questions:
1. Check the console for error messages (F12 in development mode)
2. Verify your manuscript format matches the supported patterns
3. Try with the included sample manuscript first

## License

MIT License - See LICENSE file for details

## Roadmap

### Phase 2: Continuity Analysis
- Detect pronoun issues without antecedents
- Identify timeline conflicts
- Find missing character introductions
- Spot plot reference problems

### Phase 3: AI-Powered Rewriting
- Generate scene rewrites for new positions
- Address continuity issues automatically
- Preserve story elements while adapting context
- Diff view for reviewing changes

### Phase 4: Advanced Features
- Multiple manuscript support
- Advanced scene splitting options
- Export to various formats
- Performance and reliability improvements

---

**Note**: This is Phase 1 of the complete Rewrite Assistant vision. The application currently focuses on scene reordering functionality. Future phases will add continuity analysis and AI-powered rewriting capabilities.


## LLM Capabilities Overview

The app includes provider‑specific prompting, strict validation with normalization, adaptive routing, consensus for critical runs, and accurate cost management.

- Model‑specific prompting and structured outputs
  - Claude: XML‑structured prompts with chain‑of‑thought kept internal; JSON‑only output contract.
    - See [buildClaudePrompt()](src/services/ai/prompts/ClaudePrompts.ts:9) and [ClaudeProvider.formatPrompt()](src/services/ai/providers/ClaudeProvider.ts:35)
  - OpenAI: Markdown system message with few‑shot guidance; structured outputs via JSON Schema response_format.
    - See [buildOpenAIPrompt()](src/services/ai/prompts/OpenAIPrompts.ts:44), [getOpenAIResponseFormat()](src/services/ai/prompts/OpenAIPrompts.ts:138), and [OpenAIProvider.formatPrompt()](src/services/ai/providers/OpenAIProvider.ts:33)
  - Gemini: Instruction + parts layout with JSON‑only via response_mime_type when supported.
    - See [buildGeminiPrompt()](src/services/ai/prompts/GeminiPrompts.ts:48) and [GeminiProvider.formatPrompt()](src/services/ai/providers/GeminiProvider.ts:44)

- Validation and parsing reliability
  - Strict Zod schemas with fallback repairs and normalization for spans, strings, evidence, and confidences.
  - See [AnalysisResponseSchema](src/services/ai/schemas/ResponseSchemas.ts:27) and [validateAndNormalize()](src/services/ai/utils/ResponseValidator.ts:742)

- Adaptive routing with performance tracking
  - EMA tracking of confidence, latency, and success per model and taskType; confidence thresholds gate acceptance.
  - See [ModelPerformanceTracker](src/services/ai/optimization/ModelPerformanceTracker.ts:78) and [selectModel()](src/services/ai/AIServiceManager.ts:481)

- Multi‑model consensus (critical scenes only)
  - Sequential multi‑model runs; reconciliation by voting on issue type/severity/span with confidence boosts for agreement.
  - See [ValidationPipeline.runConsensus()](src/services/ai/validation/ValidationPipeline.ts:167)

- Cost estimation and token budgets
  - Token estimation, pricing table with overrides, and optional input budgets that trim oldest previous scenes first.
  - See [estimateTokensForModel()](src/services/ai/utils/Tokenizers.ts:142), [estimateMessageTokens()](src/services/ai/utils/Tokenizers.ts:156), [getModelPricing()](src/services/ai/optimization/Pricing.ts:110), [estimateCost()](src/services/ai/optimization/Pricing.ts:119), and [BaseProvider.enforceInputBudget()](src/services/ai/providers/BaseProvider.ts:174)

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
  - Enforced by [BaseProvider.enforceInputBudget()](src/services/ai/providers/BaseProvider.ts:174)

- MAX_OUTPUT_TOKENS_PER_REQUEST
  - Reserved for future use; not strictly enforced yet.

- MAX_TOKENS_PER_SESSION
  - Session‑scoped soft accounting (informational).

- HARD_FAIL_ON_BUDGET
  - If "true", throws when input still exceeds the budget after best‑effort trimming.

Optional batching for deduplication (not wired into providers by default):
- [batchAnalyze()](src/services/ai/optimization/RequestBatcher.ts:10)

Marking a run critical to activate consensus:
- Use renderer‑side adapters with critical: true, which trigger consensus reconciliation for high‑stakes scenes:
  - [runAnalysisWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:109)
  - [runRewriteWithOptionalConsensus()](src/services/ai/consensus/ConsensusAdapter.ts:167)
- See docs/Consensus and Validation.md for details.

## Reliability Targets and Measurement

- JSON parsing reliability: Promote strict JSON‑only outputs via provider‑specific prompting; fallback repairs and Zod normalization cover edge cases.
  - See [validateAndNormalize()](src/services/ai/utils/ResponseValidator.ts:742)
- Latency target: Sub‑5s typical response for simple analyses.
  - EMA‑based routing favors faster, reliable models under current conditions.
  - See [ModelPerformanceTracker.score()](src/services/ai/optimization/ModelPerformanceTracker.ts:150)
- Accuracy improvements: Driven by prompting decisions, routing heuristics, and consensus on critical runs rather than variability tuning.

## Further Reading

- Prompting Decisions: docs/Prompting Decisions.md
- Performance Tuning Guide: docs/Performance Tuning Guide.md
- Cost Management: docs/Cost Management.md
- Consensus and Validation: docs/Consensus and Validation.md
