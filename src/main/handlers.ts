import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mainWindow } from './index';
import { IPC_CHANNELS, SUPPORTED_FILE_TYPES, DEFAULT_MANUSCRIPT_FILE } from '../shared/constants';
import { Manuscript, Scene, ReaderKnowledge, RewriteVersion, ConsultationContext, ConsultationQuery, ConsultationResponse, ConsultationSession } from '../shared/types';
import AIServiceManager from '../services/ai/AIServiceManager';
import SceneRewriter from '../services/rewrite/SceneRewriter';
import type { AnalysisRequest, AnalysisType, ClaudeConfig, OpenAIConfig, GeminiConfig } from '../services/ai/types';
import AnalysisCache from '../services/cache/AnalysisCache';
import ManuscriptExporter, { ExportOptions } from '../services/export/ManuscriptExporter';
import settingsService from './services/SettingsService';
import { registerGlobalCoherenceHandlers } from './handlers/globalCoherence';
import { redactObjectSecrets } from '../shared/security';
import ConsultationContextService, { ContextOptions } from '../services/consultation/ConsultationContextService';
 
// AI service manager singleton and helpers
/**
 * Create a single app-wide AIServiceManager instance for provider usage, caching, and metrics.
 */
const aiManager = new AIServiceManager();
const manuscriptExporter = new ManuscriptExporter();
// Scene rewriter will be instantiated per request to ensure proper mocking in tests

// Cache singleton for analysis results (lazy init)
const analysisCache = new AnalysisCache();

// Consultation services and session management
const consultationContextService = new ConsultationContextService({ enableCache: true });
const consultationSessions = new Map<string, ConsultationSession>();

// Session cleanup after 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of consultationSessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      consultationSessions.delete(sessionId);
      console.log(`[ConsultationHandler] Cleaned up expired session: ${sessionId}`);
    }
  }
}

// Periodic cleanup every 10 minutes
setInterval(cleanupExpiredSessions, 10 * 60 * 1000);

function generateSessionId(): string {
  return `consultation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function selectModelForConsultation(query: string, hasComplexContext: boolean): AnalysisType {
  const queryLower = query.toLowerCase();

  // Complex analysis for narrative structure questions
  if (queryLower.includes('manuscript') || queryLower.includes('overall') ||
      queryLower.includes('structure') || queryLower.includes('flow') ||
      hasComplexContext) {
    return 'complex';
  }

  // Consistency checks for character/timeline questions
  if (queryLower.includes('character') || queryLower.includes('timeline') ||
      queryLower.includes('continuity') || queryLower.includes('consistent')) {
    return 'consistency';
  }

  // Simple questions about specific issues
  return 'simple';
}

function buildConsultationPrompt(query: string, context: ConsultationContext, conversationHistory: ConsultationSession['conversationHistory']): string {
  const { selectedScenes, continuityAnalyses, readerKnowledge, globalCoherenceAnalysis } = context;

  let prompt = `You are a manuscript consultation assistant helping an author understand the implications of their scene reordering choices. This is consultation only - you should help them understand their current arrangement, not suggest "better" alternatives.

CURRENT CONSULTATION CONTEXT:

Selected Scenes: ${selectedScenes.length} scene(s)
- ${selectedScenes.map(s => `Scene "${s.id}" (Position ${s.position}): ${s.text.substring(0, 100)}...`).join('\n- ')}

Reader Knowledge at this point:
- Known Characters: ${Array.from(readerKnowledge.knownCharacters).join(', ') || 'None'}
- Timeline Events: ${readerKnowledge.establishedTimeline.map(t => t.label).join(', ') || 'None'}
- Revealed Plot Points: ${readerKnowledge.revealedPlotPoints.join(', ') || 'None'}
- Established Settings: ${readerKnowledge.establishedSettings.map(s => s.name).join(', ') || 'None'}`;

  if (continuityAnalyses.length > 0) {
    prompt += `\n\nCONTINUITY ISSUES DETECTED:`;
    for (const analysis of continuityAnalyses) {
      if (analysis.issues.length > 0) {
        prompt += `\nScene issues (confidence: ${Math.round(analysis.confidence * 100)}%):`;
        for (const issue of analysis.issues) {
          prompt += `\n- ${issue.type} (${issue.severity}): ${issue.description}`;
          if (issue.suggestedFix) {
            prompt += ` | Suggested fix: ${issue.suggestedFix}`;
          }
        }
      }
    }
  }

  if (globalCoherenceAnalysis) {
    prompt += `\n\nGLOBAL COHERENCE CONTEXT:
- Manuscript-level structural integrity: ${Math.round(globalCoherenceAnalysis.manuscriptLevel.structuralIntegrity * 100)}%
- Thematic coherence: ${Math.round(globalCoherenceAnalysis.manuscriptLevel.thematicCoherence * 100)}%`;

    if (globalCoherenceAnalysis.flowIssues.length > 0) {
      prompt += `\n- Flow issues detected: ${globalCoherenceAnalysis.flowIssues.length}`;
    }
  }

  if (conversationHistory.length > 0) {
    prompt += `\n\nCONVERSATION HISTORY:`;
    for (const exchange of conversationHistory.slice(-3)) { // Last 3 exchanges
      prompt += `\nQ: ${exchange.query.question}`;
      prompt += `\nA: ${exchange.response.answer.substring(0, 200)}...`;
    }
  }

  prompt += `\n\nUSER QUESTION: ${query}

Please provide a helpful consultation response that:
1. Directly addresses their question about the current scene arrangement
2. References specific continuity issues or context when relevant
3. Explains the implications of their choices without suggesting changes
4. Maintains focus on understanding rather than optimization

Response:`;

  return prompt;
}
let cacheInitialized = false;
async function ensureCacheInit(): Promise<void> {
  if (cacheInitialized) return;
  try {
    await analysisCache.init();
    cacheInitialized = true;
  } catch {
    // swallow
  }
}

/**
 * Normalize ReaderKnowledge from IPC-safe payloads into the strict Set-based structure.
 * - If knownCharacters is an array, convert to Set<string>.
 * - If it's already a Set, leave as-is.
 * - Other fields fall back to empty arrays when absent.
 */
function normalizeReaderKnowledge(raw: unknown): ReaderKnowledge {
  const fallback: ReaderKnowledge = {
    knownCharacters: new Set<string>(),
    establishedTimeline: [],
    revealedPlotPoints: [],
    establishedSettings: [],
  };
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;

  const known = (obj as Record<string, unknown>).knownCharacters;
  let knownSet: Set<string>;
  if (known instanceof Set) {
    knownSet = known;
  } else if (Array.isArray(known)) {
    knownSet = new Set<string>(known.filter((s: unknown) => typeof s === 'string'));
  } else {
    knownSet = new Set<string>();
  }

  return {
    knownCharacters: knownSet,
    establishedTimeline: Array.isArray((obj as Record<string, unknown>).establishedTimeline) ? ((obj as Record<string, unknown>).establishedTimeline as ReaderKnowledge['establishedTimeline']) : ([] as ReaderKnowledge['establishedTimeline']),
    revealedPlotPoints: Array.isArray((obj as Record<string, unknown>).revealedPlotPoints) ? ((obj as Record<string, unknown>).revealedPlotPoints as string[]) : [],
    establishedSettings: Array.isArray((obj as Record<string, unknown>).establishedSettings) ? ((obj as Record<string, unknown>).establishedSettings as ReaderKnowledge['establishedSettings']) : ([] as ReaderKnowledge['establishedSettings']),
  };
}

/**
 * Build a standardized error response with a stable shape for IPC handlers.
 */
function toErrorResponse(
  err: unknown,
  code: string
): { ok: false; error: { message: string; code: string } } {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
  return { ok: false as const, error: { message: String(message), code } };
}

// Scene parsing utility
function parseManuscriptIntoScenes(content: string, filePath: string): Manuscript {
  const lines = content.split('\n');
  const scenes: Scene[] = [];
  
  // Find all SCENE markers in your specific format: [SCENE: CHxx_Syy ...]
  const sceneBreaks: number[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Only split on actual scene markers, not chapter headers
    if (line.match(/^\[SCENE:\s*CH\d+_S\d+/i)) {
      sceneBreaks.push(i);
    }
  }
  
  // If no scene markers found, fall back to other patterns
  if (sceneBreaks.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^===\s*(Chapter|CHAPTER)\s+\d+\s*===/i) ||
          line.match(/^(Chapter|CHAPTER|Scene|SCENE)\s+\d+/i) || 
          line.match(/^###\s*SCENE\s*BREAK\s*###/i)) {
        if (i > 0) sceneBreaks.push(i);
      }
    }
  }
  
  // If still no markers found, split on double newlines
  if (sceneBreaks.length === 0) {
    const chunks = content.split(/\n\s*\n/);
    chunks.forEach((chunk, index) => {
      if (chunk.trim().length > 0) {
        const scene: Scene = {
          id: `scene-${index + 1}`,
          text: chunk.trim(),
          wordCount: chunk.trim().split(/\s+/).length,
          position: index,
          originalPosition: index,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        };
        scenes.push(scene);
      }
    });
  } else {
    // Add the end of file as the final break
    sceneBreaks.push(lines.length);
    
    // Start from the beginning of the file for the first scene
    let startLine = 0;
    
    for (let i = 0; i < sceneBreaks.length; i++) {
      const endLine = sceneBreaks[i];
      const sceneText = lines.slice(startLine, endLine).join('\n').trim();
      
      // Only create a scene if there's meaningful content
      if (sceneText.length > 50) { // Minimum length to avoid empty or header-only scenes
        // Find the scene identifier in this chunk
        let sceneId = `scene-${scenes.length + 1}`;
        
        // Look for the scene marker in this text chunk
        const sceneLines = sceneText.split('\n');
        for (const line of sceneLines) {
          const sceneMatch = line.match(/^\[SCENE:\s*(CH\d+_S\d+)/i);
          if (sceneMatch) {
            sceneId = sceneMatch[1].toLowerCase();
            break;
          }
        }
        
        // If this is the first scene and no scene marker found, look for chapter info
        if (sceneId.startsWith('scene-') && scenes.length === 0) {
          for (const line of sceneLines) {
            const chapterMatch = line.match(/^===\s*(Chapter|CHAPTER)\s+(\d+)\s*===/i);
            if (chapterMatch) {
              sceneId = `ch${chapterMatch[2].padStart(2, '0')}_s01`;
              break;
            }
          }
        }
        
        const scene: Scene = {
          id: sceneId,
          text: sceneText,
          wordCount: sceneText.split(/\s+/).length,
          position: scenes.length,
          originalPosition: scenes.length,
          characters: [],
          timeMarkers: [],
          locationMarkers: [],
          hasBeenMoved: false,
          rewriteStatus: 'pending'
        };
        scenes.push(scene);
      }
      
      // Next scene starts where this one ended
      startLine = endLine;
    }
  }
  
  console.log('Scene parsing complete:', {
    totalScenes: scenes.length,
    sceneIds: scenes.slice(0, 5).map(s => s.id), // First 5 scene IDs for debugging
    expectedScenes: sceneBreaks.length > 0 ? sceneBreaks.length : 'unknown'
  });
  
  const manuscript: Manuscript = {
    id: `manuscript-${Date.now()}`,
    title: path.basename(filePath, '.txt'),
    scenes,
    originalOrder: scenes.map(s => s.id),
    currentOrder: scenes.map(s => s.id),
    filePath
  };
  
  return manuscript;
}

export function setupIPCHandlers(): void {
  // Handle file loading with dialog
  ipcMain.handle(IPC_CHANNELS.LOAD_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: SUPPORTED_FILE_TYPES
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      
      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf-8');
      const manuscript = parseManuscriptIntoScenes(content, filePath);
      
      return manuscript;
    } catch (error) {
      console.error('Error loading file:', redactObjectSecrets(error));
      throw error;
    }
  });

  // Handle loading specific file without dialog
  ipcMain.handle(IPC_CHANNELS.LOAD_SPECIFIC_FILE, async (event, filePath: string) => {
    try {
      // Check if file exists
      if (!await fs.access(filePath).then(() => true).catch(() => false)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      const manuscript = parseManuscriptIntoScenes(content, filePath);
      
      return manuscript;
    } catch (error) {
      console.error('Error loading specific file:', redactObjectSecrets(error));
      throw error;
    }
  });

  // Handle auto-loading manuscript.txt from the project root
  ipcMain.handle(IPC_CHANNELS.AUTO_LOAD_MANUSCRIPT, async () => {
    try {
      // Resolve manuscript path via robust candidate order (dev and packaged):
      // 1) CWD + default (current behavior)
      // 2) two dirs up from __dirname (dev build output -> repo root)
      // 3) app path (packaged: resources/app)
      // 4) executable directory (packaged: next to binary)
      const rawCandidates = [
        path.join(process.cwd(), DEFAULT_MANUSCRIPT_FILE),
        path.join(__dirname, '..', '..', DEFAULT_MANUSCRIPT_FILE),
        (app?.getAppPath ? path.join(app.getAppPath(), DEFAULT_MANUSCRIPT_FILE) : ''),
        path.join(path.dirname(process.execPath), DEFAULT_MANUSCRIPT_FILE),
      ];
      const candidates = rawCandidates.filter(Boolean) as string[];

      let manuscriptPath: string | null = null;
      for (const candidate of candidates) {
        const exists = await fs.access(candidate).then(() => true).catch(() => false);
        if (exists) { manuscriptPath = candidate; break; }
      }

      // If none of the candidates exist, behave as before
      if (!manuscriptPath) {
        console.log('Auto-load: manuscript.txt not found');
        return null; // File doesn't exist, that's OK
      }

      console.log('Auto-load: Checking for manuscript at:', manuscriptPath);

      // Proceed with the existing read/parse logic
      console.log('Auto-load: Found manuscript.txt, parsing...');
      const content = await fs.readFile(manuscriptPath, 'utf-8');
      const manuscript = parseManuscriptIntoScenes(content, manuscriptPath);

      console.log('Auto-load: Successfully parsed manuscript with', manuscript.scenes.length, 'scenes');

      return manuscript;
    } catch (error) {
      console.error('Error auto-loading manuscript:', redactObjectSecrets(error));
      return null; // Don't throw for auto-load failures
    }
  });
  
  // Handle file saving
  ipcMain.handle(IPC_CHANNELS.SAVE_FILE, async (event, manuscript: Manuscript) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: manuscript.filePath || `${manuscript.title}.txt`,
        filters: SUPPORTED_FILE_TYPES
      });
      
      if (result.canceled || !result.filePath) {
        return null;
      }
      
      // Reconstruct manuscript text from scenes in current order
      const orderedScenes = manuscript.currentOrder.map(id => 
        manuscript.scenes.find(scene => scene.id === id)
      ).filter(Boolean) as Scene[];
      
      const content = orderedScenes.map(scene => scene.text).join('\n\n');
      
      await fs.writeFile(result.filePath, content, 'utf-8');
      
      return result.filePath;
    } catch (error) {
      console.error('Error saving file:', redactObjectSecrets(error));
      throw error;
    }
  });
  // Export manuscript with rewrites
  ipcMain.handle(IPC_CHANNELS.EXPORT_WITH_REWRITES, async (event: unknown, payload: unknown) => {
    try {
      const { manuscript, rewrites, options } = (payload as Record<string, unknown>) || {};
      
      if (!manuscript) {
        return toErrorResponse('No manuscript to export', 'EXPORT_ERROR');
      }
      
      // Convert rewrites from serialized format if needed
      const rewriteMap = new Map<string, RewriteVersion[]>();
      if (rewrites) {
        if (rewrites instanceof Map) {
          (rewrites as Map<string, RewriteVersion[]>).forEach((value, key) => rewriteMap.set(key, value));
        } else if (typeof rewrites === 'object') {
          Object.entries(rewrites as Record<string, unknown>).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              rewriteMap.set(key, value as RewriteVersion[]);
            }
          });
        }
      }
      
      // Show save dialog
      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Manuscript',
        defaultPath: (options && typeof options === 'object' && !Array.isArray(options) && typeof (options as Record<string, unknown>).filename === 'string' ? ((options as Record<string, unknown>).filename as string) : `${((manuscript && typeof manuscript === 'object' && typeof (manuscript as Record<string, unknown>).title === 'string') ? ((manuscript as Record<string, unknown>).title as string) : 'manuscript')}_export.txt`),
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'Markdown Files', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });
      
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }
      
      // Update options with selected path
      const exportOptions = ({
        ...((options && typeof options === 'object') ? (options as object) : {}),
        outputPath: path.dirname(saveResult.filePath),
        filename: path.basename(saveResult.filePath)
      }) as unknown as ExportOptions;
      
      // Perform export
      const result = await manuscriptExporter.exportManuscript(
        manuscript as Manuscript,
        rewriteMap,
        exportOptions
      );
      
      // Open file location if successful
      const r = result as unknown as { success?: boolean; filePath?: string };
      if (r && r.success && typeof r.filePath === 'string') {
        try { shell.showItemInFolder(r.filePath); } catch (e) { void e; }
      }
      
      return result;
      
    } catch (error) {
      console.error('[Handlers] Export error:', redactObjectSecrets(error));
      return toErrorResponse(error, 'EXPORT_ERROR');
    }
  });

  // AI: Configure providers (Anthropic/OpenAI/Gemini)
  ipcMain.handle(IPC_CHANNELS.CONFIGURE_AI_PROVIDER, async (event: unknown, payload: unknown) => {
    try {
      const cfg: { claude?: ClaudeConfig; openai?: OpenAIConfig; gemini?: GeminiConfig } = {};
      if (payload && typeof payload === 'object') {
        const p = (payload as Record<string, unknown>);

        if (p.claude !== undefined) {
          if (p.claude && typeof p.claude === 'object' && !Array.isArray(p.claude) && typeof (p.claude as Record<string, unknown>).apiKey === 'string' && ((p.claude as Record<string, unknown>).apiKey as string).trim().length > 0) {
            cfg.claude = p.claude as ClaudeConfig;
          } else {
            console.warn('[IPC][CONFIGURE_AI_PROVIDER] Invalid claude.apiKey');
            return toErrorResponse('Invalid claude.apiKey', 'CONFIGURE_FAILED');
          }
        }

        if (p.openai !== undefined) {
          if (p.openai && typeof p.openai === 'object' && !Array.isArray(p.openai) && typeof (p.openai as Record<string, unknown>).apiKey === 'string' && ((p.openai as Record<string, unknown>).apiKey as string).trim().length > 0) {
            cfg.openai = p.openai as OpenAIConfig;
          } else {
            console.warn('[IPC][CONFIGURE_AI_PROVIDER] Invalid openai.apiKey');
            return toErrorResponse('Invalid openai.apiKey', 'CONFIGURE_FAILED');
          }
        }

        if (p.gemini !== undefined) {
          if (p.gemini && typeof p.gemini === 'object' && !Array.isArray(p.gemini) && typeof (p.gemini as Record<string, unknown>).apiKey === 'string' && ((p.gemini as Record<string, unknown>).apiKey as string).trim().length > 0) {
            cfg.gemini = p.gemini as GeminiConfig;
          } else {
            console.warn('[IPC][CONFIGURE_AI_PROVIDER] Invalid gemini.apiKey');
            return toErrorResponse('Invalid gemini.apiKey', 'CONFIGURE_FAILED');
          }
        }
      }

      aiManager.configure(cfg);
      console.log('[IPC][CONFIGURE_AI_PROVIDER] Providers configured:', Object.keys(cfg));
      return { ok: true };
    } catch (err) {
      console.warn('[IPC][CONFIGURE_AI_PROVIDER] configure failed:', redactObjectSecrets(err));
      return toErrorResponse(err, 'CONFIGURE_FAILED');
    }
  });

  // AI: Test provider configuration (lightweight, no network)
  ipcMain.handle('test-ai-provider', async (_event, payload: unknown) => {
    try {
      const invalid = () => ({ ok: false as const, error: { message: 'Invalid configuration', code: 'INVALID_CONFIG' } });

      if (!payload || typeof payload !== 'object') return invalid();
      const { provider, config } = payload as { provider?: string; config?: unknown };

      const allowed = new Set(['claude', 'openai', 'gemini']);
      if (typeof provider !== 'string' || !allowed.has(provider)) return invalid();

      if (!config || typeof config !== 'object') return invalid();
      const cfgObj = config as Record<string, unknown>;
      const apiKey = typeof cfgObj.apiKey === 'string' ? cfgObj.apiKey.trim() : '';
      if (!apiKey || apiKey.length < 20) return invalid();
      if (cfgObj.model !== undefined) {
        if (typeof cfgObj.model !== 'string' || !cfgObj.model.trim()) return invalid();
      }
      if (cfgObj.baseUrl !== undefined) {
        if (typeof cfgObj.baseUrl !== 'string') return invalid();
        const base = cfgObj.baseUrl.trim();
        if (base && !/^https?:\/\//i.test(base)) return invalid();
      }

      // Artificial async delay ~100-200ms
      const delay = 100 + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));

      return { ok: true as const };
    } catch {
      // Do not log secrets or payload
      return { ok: false as const, error: { message: 'Invalid configuration', code: 'INVALID_CONFIG' } };
    }
  });

  // AI: Analyze continuity
  ipcMain.handle(IPC_CHANNELS.ANALYZE_CONTINUITY, async (event: unknown, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return toErrorResponse('Invalid payload', 'ANALYZE_FAILED');
      }
      const p = payload as Record<string, unknown>;
      const scene = p.scene as unknown;
      const previousScenes = Array.isArray(p.previousScenes) ? (p.previousScenes as Scene[]) : [];
      const analysisType = p.analysisType as AnalysisType;
      const allowed: AnalysisType[] = ['simple', 'consistency', 'complex', 'full'];

      if (!scene || typeof (scene as Record<string, unknown>).text !== 'string') {
        console.warn('[IPC][ANALYZE_CONTINUITY] Invalid scene payload');
        return toErrorResponse('Invalid scene', 'ANALYZE_FAILED');
      }
      if (!allowed.includes(analysisType)) {
        console.warn('[IPC][ANALYZE_CONTINUITY] Invalid analysisType:', analysisType);
        return toErrorResponse('Invalid analysisType', 'ANALYZE_FAILED');
      }

      const readerContext = normalizeReaderKnowledge(p.readerContext);
      const req: AnalysisRequest = { scene: scene as Scene, previousScenes, analysisType, readerContext };

      const res = await aiManager.analyzeContinuity(req);
      return res;
    } catch (err) {
      console.warn('[IPC][ANALYZE_CONTINUITY] analyze failed:', redactObjectSecrets(err));
      const base = toErrorResponse(err, 'ANALYZE_FAILED');
      return { ...base, metadata: { providerState: aiManager.getMetrics().lastErrors } };
    }
  });

  // AI: Generate single-scene rewrite
  ipcMain.handle(IPC_CHANNELS.GENERATE_REWRITE, async (event: unknown, payload: unknown) => {
    try {
      console.log('[Handlers] Generate rewrite request for scene:', (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).sceneId : undefined));

      // Validate payload
      if (!(payload && typeof payload === 'object' && !Array.isArray(payload) && (payload as Record<string, unknown>).scene) || !(payload && typeof payload === 'object' && !Array.isArray(payload) && (payload as Record<string, unknown>).issues) || !Array.isArray(((payload as Record<string, unknown>).issues as unknown[])) || (((payload as Record<string, unknown>).issues as unknown[]).length === 0)) {
        return toErrorResponse('Invalid request: missing scene or issues', 'REWRITE_GENERATION_ERROR');
      }

      // Build reader context from provided or defaults
      const readerContext = normalizeReaderKnowledge(((payload && typeof payload === 'object') ? (payload as Record<string, unknown>).readerContext : undefined) || {
        knownCharacters: new Set(),
        establishedTimeline: [],
        revealedPlotPoints: [],
        establishedSettings: [],
      });

      // Previous scenes for context (limit to last 3)
      const previousScenes = (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).previousScenes)) ? (((payload as Record<string, unknown>).previousScenes as Scene[]).slice(-3)) : [];

      // Create rewrite request
      const request = {
        scene: (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).scene as Scene : (undefined as unknown as Scene)),
        issuesFound: (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).issues : undefined),
        readerContext,
        previousScenes,
        preserveElements: (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).preserveElements)) ? ((payload as Record<string, unknown>).preserveElements as unknown[]) : [],
      };

      // Generate rewrite (instantiate per-call to cooperate with test mocks)
      // Extremely defensive unwrapping to handle ESM/CJS and Vitest mock shapes.
      const unwrapCtor = (mod: unknown): unknown => {
       let c: unknown = mod;
       for (let i = 0; i < 4; i++) {
         if (c && typeof c === 'object' && !Array.isArray(c) && 'default' in c) {
           c = (c as Record<string, unknown>).default as unknown;
         } else {
           break;
         }
       }
       return c;
     };

      let localRewriter: unknown = null;
      const C0: unknown = unwrapCtor(SceneRewriter as unknown);

      // Try as class with dependency
      try { localRewriter = new (C0 as { new (...args: unknown[]): unknown })(aiManager); } catch (e) { void e; }

      // Try as factory with dependency
      if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
        try { localRewriter = (C0 as (...args: unknown[]) => unknown)(aiManager); } catch (e) { void e; }
      }

      // Try no-arg variants (some mocks ignore ctor args)
      if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
        try { localRewriter = new (C0 as { new (...args: unknown[]): unknown })(); } catch (e) { void e; }
      }
      if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
        try { localRewriter = (C0 as (...args: unknown[]) => unknown)(); } catch (e) { void e; }
      }

      // Final sanity: if still not available, attempt one more unwrap level
      if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
        const C1: unknown = unwrapCtor(C0);
        try { localRewriter = new (C1 as { new (...args: unknown[]): unknown })(aiManager); } catch (e) { void e; }
        if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
          try { localRewriter = (C1 as (...args: unknown[]) => unknown)(aiManager); } catch (e) { void e; }
        }
        if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
          try { localRewriter = new (C1 as { new (...args: unknown[]): unknown })(); } catch (e) { void e; }
        }
        if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
          try { localRewriter = (C1 as (...args: unknown[]) => unknown)(); } catch (e) { void e; }
        }
      }

      // At this point, tests that mock SceneRewriter should have provided rewriteScene
      // If not, return a structured error without throwing to avoid failing IPC handler entirely
      if (!localRewriter || typeof (localRewriter as Record<string, unknown>).rewriteScene !== 'function') {
        console.error('[Handlers] SceneRewriter mock/impl did not expose rewriteScene');
        return toErrorResponse('Rewrite engine unavailable', 'REWRITE_GENERATION_ERROR');
      }

      const result = await (localRewriter as { rewriteScene: (req: unknown) => Promise<unknown> | unknown }).rewriteScene(request);

      // Send progress update (if a main window pattern exists)
      const win = typeof mainWindow !== 'undefined' && mainWindow ? mainWindow : (BrowserWindow.getAllWindows?.()[0] || undefined);
      if (win && !win.isDestroyed?.()) {
        const status = (result && typeof result === 'object' && !Array.isArray(result) && Boolean((result as Record<string, unknown>).success)) ? 'complete' : 'failed';
        win.webContents.send(IPC_CHANNELS.REWRITE_PROGRESS, {
          sceneId: ((payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).sceneId === 'string') ? ((payload as Record<string, unknown>).sceneId as string) : ((payload && typeof payload === 'object' && (payload as Record<string, unknown>).scene && typeof ((payload as Record<string, unknown>).scene as Record<string, unknown>).id === 'string') ? (((payload as Record<string, unknown>).scene as Record<string, unknown>).id as string) : undefined)),
          status,
        });
      }

      return result;
    } catch (error) {
      console.error('[Handlers] Rewrite generation error:', redactObjectSecrets(error));
      // Keep existing error-to-response mapping utility
      return toErrorResponse(error, 'REWRITE_GENERATION_ERROR');
    }
  });

  // AI: Get analysis/metrics status
  ipcMain.handle(IPC_CHANNELS.GET_ANALYSIS_STATUS, async () => {
    try {
      return aiManager.getMetrics();
    } catch (err) {
      console.warn('[IPC][GET_ANALYSIS_STATUS] metrics failed:', redactObjectSecrets(err));
      return toErrorResponse(err, 'STATUS_FAILED');
    }
  });

  // Cache management: stats, clear, warm
  ipcMain.handle(IPC_CHANNELS.GET_CACHE_STATS, async () => {
    try { await ensureCacheInit(); } catch (e) { void e; }
    try { return analysisCache.getStats(); } catch { return { hitRate: 0, size: 0, totalHits: 0, totalMisses: 0, avgHitTime: 0, avgGenerationTime: 0 }; }
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_ANALYSIS_CACHE, async () => {
    try { await ensureCacheInit(); } catch (e) { void e; }
    try { await analysisCache.clear(); return true; } catch { return false; }
  });

  ipcMain.handle(IPC_CHANNELS.WARM_CACHE, async (_event, scenes: Scene[] = []) => {
    try { await ensureCacheInit(); } catch (e) { void e; }
    try { await analysisCache.warmCache(Array.isArray(scenes) ? scenes : []); return true; } catch { return false; }
  });
  
  // Settings service handlers (no secrets logged)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, async () => {
    try {
      return await settingsService.loadSettings();
    } catch (error: unknown) {
      console.error('[Handlers] Settings load error:', redactObjectSecrets(error));
      return { success: false, error: (error instanceof Error ? error.message : String(error)) };
    }
  });
  
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, async (_event, settings) => {
    try {
      return await settingsService.saveSettings(settings);
    } catch (error: unknown) {
      console.error('[Handlers] Settings save error:', redactObjectSecrets(error));
      return { success: false, error: (error instanceof Error ? error.message : String(error)) };
    }
  });
  
  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_CONNECTION, async (_event, { provider, config }) => {
    try {
      return await settingsService.testConnection(provider, config);
    } catch (error: unknown) {
      console.error('[Handlers] Connection test error:', redactObjectSecrets(error));
      return { success: false, error: (error instanceof Error ? error.message : String(error)) };
    }
  });
  
  // Scene Consultation handlers
  ipcMain.handle(IPC_CHANNELS.SCENE_CONSULTATION_START, async (event: unknown, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return toErrorResponse('Invalid payload', 'CONSULTATION_START_FAILED');
      }

      const p = payload as Record<string, unknown>;
      const sceneIds = p.sceneIds as string[];
      const manuscript = p.manuscript as Manuscript;

      if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
        return toErrorResponse('Scene IDs are required', 'CONSULTATION_START_FAILED');
      }

      if (!manuscript || !manuscript.scenes || !Array.isArray(manuscript.scenes)) {
        return toErrorResponse('Valid manuscript is required', 'CONSULTATION_START_FAILED');
      }

      // Build consultation context options
      const contextOptions: ContextOptions = {
        includeContinuityAnalysis: p.includeContinuityAnalysis === true,
        includeGlobalCoherence: p.includeGlobalCoherence === true,
        includeRewriteHistory: p.includeRewriteHistory === true,
        upToSceneIndex: typeof p.upToSceneIndex === 'number' ? p.upToSceneIndex : undefined
      };

      // Build consultation context
      const context = await consultationContextService.buildContext(sceneIds, manuscript, contextOptions);

      // Create new session
      const sessionId = generateSessionId();
      const session: ConsultationSession = {
        id: sessionId,
        startTime: Date.now(),
        lastActivity: Date.now(),
        conversationHistory: [],
        isActive: true
      };

      consultationSessions.set(sessionId, session);

      console.log(`[ConsultationHandler] Started consultation session ${sessionId} for ${sceneIds.length} scenes`);

      return {
        ok: true,
        sessionId,
        context: {
          selectedScenes: context.selectedScenes.map(s => ({ id: s.id, position: s.position })), // Minimal scene info for response
          sceneCount: context.selectedScenes.length,
          continuityIssueCount: context.continuityAnalyses.reduce((sum, a) => sum + a.issues.length, 0),
          hasGlobalCoherence: !!context.globalCoherenceAnalysis,
          readerKnowledgeSummary: {
            charactersCount: context.readerKnowledge.knownCharacters.size,
            timelineEventsCount: context.readerKnowledge.establishedTimeline.length,
            plotPointsCount: context.readerKnowledge.revealedPlotPoints.length,
            settingsCount: context.readerKnowledge.establishedSettings.length
          }
        }
      };
    } catch (err) {
      console.error('[ConsultationHandler] Start session failed:', redactObjectSecrets(err));
      return toErrorResponse(err, 'CONSULTATION_START_FAILED');
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCENE_CONSULTATION_QUERY, async (event: unknown, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return toErrorResponse('Invalid payload', 'CONSULTATION_QUERY_FAILED');
      }

      const queryPayload = payload as ConsultationQuery;
      const sessionId = queryPayload.sessionId;

      if (!sessionId || typeof queryPayload.question !== 'string' || !queryPayload.question.trim()) {
        return toErrorResponse('Session ID and question are required', 'CONSULTATION_QUERY_FAILED');
      }

      // Get existing session
      const session = consultationSessions.get(sessionId);
      if (!session || !session.isActive) {
        return toErrorResponse('Session not found or expired', 'CONSULTATION_SESSION_NOT_FOUND');
      }

      // Update session activity
      session.lastActivity = Date.now();

      // Rebuild context for this query (in case manuscript has changed)
      const manuscript = (payload as any).manuscript as Manuscript;
      if (!manuscript) {
        return toErrorResponse('Manuscript is required for consultation query', 'CONSULTATION_QUERY_FAILED');
      }

      const contextOptions: ContextOptions = {
        includeContinuityAnalysis: queryPayload.includeContext.continuityIssues,
        includeGlobalCoherence: queryPayload.includeContext.globalCoherence,
        includeRewriteHistory: queryPayload.includeContext.rewriteHistory
      };

      const context = await consultationContextService.buildContext(
        queryPayload.selectedSceneIds,
        manuscript,
        contextOptions
      );

      // Build AI prompt
      const prompt = buildConsultationPrompt(queryPayload.question, context, session.conversationHistory);

      // Determine analysis type based on query complexity and context
      const hasComplexContext = context.globalCoherenceAnalysis !== undefined ||
                               context.continuityAnalyses.length > 3 ||
                               context.selectedScenes.length > 5;

      const analysisType = selectModelForConsultation(queryPayload.question, hasComplexContext);

      // Create analysis request using a dummy scene for AI routing
      const dummyScene: Scene = {
        id: 'consultation-query',
        text: prompt,
        wordCount: prompt.split(' ').length,
        position: 0,
        originalPosition: 0,
        characters: [],
        timeMarkers: [],
        locationMarkers: [],
        hasBeenMoved: false,
        rewriteStatus: 'pending'
      };

      const analysisRequest: AnalysisRequest = {
        scene: dummyScene,
        previousScenes: [],
        analysisType,
        readerContext: context.readerKnowledge
      };

      // Get AI response
      const aiResponse = await aiManager.analyzeContinuity(analysisRequest);

      // Extract answer from AI response (assuming it's in the first issue description or we need to adapt this)
      let answer = 'I understand your question about the scene arrangement. ';
      if (aiResponse.issues && aiResponse.issues.length > 0) {
        // For consultation, the "issues" field will contain the consultation response
        answer = aiResponse.issues[0]?.description || answer;
      }

      // Create consultation response
      const consultationResponse: ConsultationResponse = {
        answer,
        confidence: aiResponse.metadata.confidence || 0.8,
        referencedIssues: context.continuityAnalyses.flatMap(a => a.issues).slice(0, 5), // Top 5 relevant issues
        referencedScenes: context.selectedScenes.map(s => s.id),
        timestamp: Date.now(),
        modelUsed: aiResponse.metadata.modelUsed,
        sessionId
      };

      // Add to conversation history
      session.conversationHistory.push({
        query: queryPayload,
        response: consultationResponse,
        timestamp: Date.now()
      });

      // Limit history size to prevent memory growth
      if (session.conversationHistory.length > 10) {
        session.conversationHistory = session.conversationHistory.slice(-10);
      }

      console.log(`[ConsultationHandler] Processed query in session ${sessionId}, model: ${aiResponse.metadata.modelUsed}`);

      return consultationResponse;
    } catch (err) {
      console.error('[ConsultationHandler] Query failed:', redactObjectSecrets(err));
      return toErrorResponse(err, 'CONSULTATION_QUERY_FAILED');
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCENE_CONSULTATION_GET_CONTEXT, async (event: unknown, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return toErrorResponse('Invalid payload', 'CONSULTATION_GET_CONTEXT_FAILED');
      }

      const p = payload as { sessionId: string };
      const sessionId = p.sessionId;

      if (!sessionId) {
        return toErrorResponse('Session ID is required', 'CONSULTATION_GET_CONTEXT_FAILED');
      }

      const session = consultationSessions.get(sessionId);
      if (!session) {
        return toErrorResponse('Session not found', 'CONSULTATION_SESSION_NOT_FOUND');
      }

      // Update last activity
      session.lastActivity = Date.now();

      return {
        ok: true,
        sessionId,
        isActive: session.isActive,
        startTime: session.startTime,
        lastActivity: session.lastActivity,
        conversationCount: session.conversationHistory.length
      };
    } catch (err) {
      console.error('[ConsultationHandler] Get context failed:', redactObjectSecrets(err));
      return toErrorResponse(err, 'CONSULTATION_GET_CONTEXT_FAILED');
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCENE_CONSULTATION_END, async (event: unknown, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return toErrorResponse('Invalid payload', 'CONSULTATION_END_FAILED');
      }

      const p = payload as { sessionId: string };
      const sessionId = p.sessionId;

      if (!sessionId) {
        return toErrorResponse('Session ID is required', 'CONSULTATION_END_FAILED');
      }

      const session = consultationSessions.get(sessionId);
      const existed = !!session;

      if (session) {
        session.isActive = false;
        consultationSessions.delete(sessionId);

        console.log(`[ConsultationHandler] Ended consultation session ${sessionId} with ${session.conversationHistory.length} exchanges`);
      }

      return {
        ok: true,
        sessionId,
        ended: existed,
        message: existed ? 'Session ended successfully' : 'Session was already ended or did not exist'
      };
    } catch (err) {
      console.error('[ConsultationHandler] End session failed:', redactObjectSecrets(err));
      return toErrorResponse(err, 'CONSULTATION_END_FAILED');
    }
  });

  // Global Coherence handlers registration
  registerGlobalCoherenceHandlers(aiManager, mainWindow);
}
 
