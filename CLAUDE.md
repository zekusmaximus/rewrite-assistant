# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development
- `npm start` - Start the Electron app in development mode (Forge + Vite)
- `npm run lint` - Run ESLint with max 0 warnings
- `npm run lint:fix` - Auto-fix linting issues
- `npm run typecheck` - Run TypeScript type checking
- `npm test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage reporting

### Build & Package
- `npm run package` - Package the app (no installer)
- `npm run make` - Create platform-specific installers
- `npm run ci:all` - Full CI pipeline (install, typecheck, lint, test, build)

### Testing Individual Components
- Run specific test files with `npx vitest path/to/test.js`
- Use `npm run test:watch` to run tests continuously during development

## Project Architecture

This is an Electron desktop application that helps authors rewrite manuscript scenes after reordering them. It uses a three-process architecture:

### Main Process (`src/main/`)
- **Entry point**: `src/main/index.ts` - Sets up BrowserWindow, IPC handlers, AI status monitoring
- **IPC Handlers**: `src/main/handlers.ts` - File operations, AI service coordination
- **Settings Service**: `src/main/services/SettingsService.ts` - Encrypted API key storage using Electron's safeStorage
- **Global Coherence**: `src/main/handlers/globalCoherence.ts` - Manuscript-wide analysis handlers

### Renderer Process (`src/renderer/`)
- **Entry point**: `src/renderer/src/index.tsx` with error boundaries
- **Main component**: `src/renderer/src/App.tsx` - Coordinates all UI features
- **Feature-based structure**:
  - `features/reorder/` - Drag-and-drop scene reordering
  - `features/analyze/` - Continuity issue detection (local + AI)
  - `features/rewrite/` - AI-powered scene rewriting with batch support
  - `features/settings/` - Provider configuration UI
  - `features/export/` - Export engine with multiple formats
  - `features/coherence/` - Global narrative analysis

### Services Layer (`src/services/`)
- **AI Services**: `src/services/ai/` - Multi-provider AI orchestration
  - `AIServiceManager.ts` - Main coordinator with adaptive routing
  - `providers/` - Claude, OpenAI, Gemini implementations
  - `consensus/` - Multi-model validation for critical operations
  - `optimization/` - Performance tracking, pricing, request batching
- **Caching**: `src/services/cache/` - Analysis result caching with semantic hashing
- **Export Engine**: `src/services/export/ManuscriptExporter.ts` - Export to various formats

## Key Technical Concepts

### AI Provider Management
- **Provider configuration**: Settings stored encrypted in userData/settings.json
- **Adaptive routing**: Cheaper models first, escalation based on confidence thresholds
- **Consensus mode**: Multi-model validation for high-stakes rewrites
- **Cost tracking**: Token estimation with configurable budgets (env vars)

### State Management
- **Zustand stores** for all UI state
- **Manuscript Store**: Scene data, reordering history with undo/redo
- **Analysis Store**: Issue detection results and caching
- **Rewrite Store**: Rewrite status, history, and batch processing
- **Settings Store**: Provider configuration state

### Continuity Analysis Pipeline
1. **Local detectors** in `src/renderer/features/analyze/detectors/` run first (PronounDetector, TimelineDetector, etc.)
2. **AI validation** selectively confirms/enhances local findings
3. **Issue aggregation** combines results with confidence scoring
4. **Caching** prevents repeated analysis of identical content

### Scene Rewriting Flow
1. **Issue-driven**: Only scenes with detected issues are rewritten
2. **Minimal changes**: Preserve author voice, fix specific problems only
3. **Diff tracking**: Show exactly what changed and why
4. **Batch processing**: Rewrite multiple scenes in narrative order

## Important Patterns

### Error Handling
- **AI Service Errors**: Circuit breakers, graceful fallbacks, user-friendly messages
- **Provider Validation**: KeyGate enforces valid API keys before expensive operations
- **React Error Boundaries**: Feature-level boundaries prevent cascading failures

### Security
- **API Keys**: Never stored in plain text, encrypted via Electron safeStorage
- **Secret Redaction**: `redactObjectSecrets()` removes keys from logs
- **IPC Bridge**: Minimal surface area between main and renderer processes

### Testing Strategy
- **Vitest** for unit tests with JSDOM environment
- **Testing Library** for React component tests
- **Mock providers** for AI service testing
- **Integration tests** in `src/__tests__/integration/`

## Development Workflow

1. **Start development**: `npm start` (opens Electron app with hot reload)
2. **Make changes**: Edit files, see live updates
3. **Test frequently**: `npm run test:watch` for continuous testing
4. **Check types**: `npm run typecheck` before committing
5. **Lint code**: `npm run lint:fix` to auto-fix issues
6. **Build/package**: `npm run make` for distribution

## File Structure Notes

- **Shared types**: `src/shared/types.ts` - Common interfaces between main/renderer
- **Preload script**: `src/main/preload.ts` - Secure IPC bridge
- **Config files**: Root-level Vite configs for main/renderer/preload builds
- **Test config**: `vitest.config.ts` and `vitest.setup.ts` for test environment

## Performance Considerations

- **Lazy loading**: Features load components on-demand
- **Request batching**: Optional deduplication for similar AI requests
- **Semantic caching**: Content-based cache keys prevent redundant analysis
- **Progressive enhancement**: App works without AI providers configured