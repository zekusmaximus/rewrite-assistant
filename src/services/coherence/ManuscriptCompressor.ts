import type { Scene, Manuscript, CompressedScene, ReaderKnowledge } from '../../shared/types';
import AIServiceManager from '../ai/AIServiceManager';
import type { AnalysisRequest } from '../ai/types';

/**
 * Compresses manuscript data for token-efficient analysis while preserving
 * critical narrative elements needed for coherence checking.
 *
 * Logging follows the console.debug style used in renderer detectors.
 * External calls (AI) are wrapped with try/catch and fall back gracefully,
 * mirroring BaseProvider error-handling philosophy without throwing upstream.
 */
export interface ManuscriptCompressorOptions {
  maxBoundaryWords?: number;
  maxSummaryWords?: number;
  useAIForSummaries?: boolean;
  aiPreviousContextScenes?: number;
  delayMsBetweenBatches?: number;
  chapterSize?: number;
}

export class ManuscriptCompressor {
  private opts: Required<ManuscriptCompressorOptions>;

  constructor(private aiManager: AIServiceManager, options: ManuscriptCompressorOptions = {}) {
    const defaults: Required<ManuscriptCompressorOptions> = {
      maxBoundaryWords: 200,
      maxSummaryWords: 150,
      useAIForSummaries: false,
      aiPreviousContextScenes: 0,
      delayMsBetweenBatches: options.useAIForSummaries ? 350 : 0,
      chapterSize: 10
    };
    this.opts = { ...defaults, ...options };
  }

  /**
   * Compress a single scene into a token-efficient representation.
   * Note: This overload does not include prior scene context.
   */
  async compressScene(scene: Scene, position: number): Promise<CompressedScene> {
    return this.compressSceneInternal(scene, position, []);
  }

  /**
   * Prepare all scenes for analysis with batching for efficiency.
   * Processes scenes in chunks, continuing on errors with per-item fallbacks.
   */
  async prepareScenesForAnalysis(scenes: Scene[]): Promise<CompressedScene[]> {
    if (!scenes || scenes.length === 0) return [];

    const batchSize = 5;
    const out: CompressedScene[] = [];

    for (let i = 0; i < scenes.length; i += batchSize) {
      const batch = scenes.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((scene, idx) => {
          const position = i + idx;
          const prevCount = this.opts.aiPreviousContextScenes;
          const previousScenes = prevCount > 0 ? scenes.slice(Math.max(0, position - prevCount), position) : [];

          return this
            .compressSceneInternal(scene, position, previousScenes)
            .catch((error) => {
              console.debug('[ManuscriptCompressor] Failed to compress scene:', scene?.id, error);
              return this.createFallbackCompression(scene, position);
            });
        })
      );

      out.push(...batchResults);

      // Progress logging for very large manuscripts
      if (scenes.length > 50 && i % 20 === 0) {
        const completed = Math.min(i + batch.length, scenes.length);
        console.debug(`[ManuscriptCompressor] Compressed ${completed}/${scenes.length} scenes`);
      }

      // Inter-batch delay to be gentle on providers if AI is used
      if (this.opts.useAIForSummaries && this.opts.delayMsBetweenBatches > 0 && i + batchSize < scenes.length) {
        await this.sleep(this.opts.delayMsBetweenBatches);
      }
    }

    return out;
  }

  /**
   * Create hierarchical manuscript skeleton for arc analysis
   */
  async createManuscriptSkeleton(manuscript: Manuscript): Promise<{
    scenes: CompressedScene[];
    chapters: Array<{ summary: string; sceneIds: string[] }>;
    acts: Array<{ summary: string; chapterRange: [number, number] }>;
    overview: string;
  }> {
    const scenes = await this.prepareScenesForAnalysis(manuscript.scenes);
    const chapters = await this.summarizeChapters(scenes);
    const acts = await this.summarizeActs(chapters, scenes.length);
    const overview = await this.createOverview(acts);

    return { scenes, chapters, acts, overview };
  }

  // ========== Internals ==========

  private async compressSceneInternal(
    scene: Scene,
    position: number,
    previousScenes: Scene[]
  ): Promise<CompressedScene> {
    try {
      const text = scene?.text ?? '';

      const opening = this.extractOpening(text, this.opts.maxBoundaryWords);
      const closing = this.extractClosing(text, this.opts.maxBoundaryWords);

      const metadata = this.extractMetadata(scene);

      let summary: string | undefined;
      if (this.opts.useAIForSummaries) {
        summary = await this.tryAISummarize(scene, previousScenes);
      }
      if (!summary) {
        summary = this.generateFallbackSummary(text);
      }

      return {
        id: scene.id,
        position,
        opening,
        closing,
        summary,
        metadata
      };
    } catch (error) {
      console.debug('[ManuscriptCompressor] Failed to compress scene:', scene?.id, error);
      return this.createFallbackCompression(scene, position);
    }
  }

  /**
   * Extract opening text, handling edge cases
   */
  private extractOpening(text: string, wordCount: number): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= wordCount) return text;
    return words.slice(0, wordCount).join(' ');
  }

  /**
   * Extract closing text, handling edge cases
   */
  private extractClosing(text: string, wordCount: number): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= wordCount) return text;
    return words.slice(-wordCount).join(' ');
  }

  /**
   * Extract metadata following patterns from existing detectors
   */
  private extractMetadata(scene: Scene): CompressedScene['metadata'] {
    const characters = Array.from(new Set(scene?.characters ?? []));
    const locations = Array.from(new Set(scene?.locationMarkers ?? []));

    const text = scene?.text ?? '';
    const emotionalTone = this.detectEmotionalTone(text);
    const tensionLevel = this.calculateTensionLevel(text);

    const wordCount =
      typeof scene?.wordCount === 'number'
        ? scene.wordCount
        : (text ? text.trim().split(/\s+/).length : 0);

    return {
      wordCount,
      characters,
      locations,
      emotionalTone,
      tensionLevel
    };
  }

  private detectEmotionalTone(text: string): string {
    const tones: Record<string, RegExp> = {
      tense: /(?:fight|argument|conflict|anger|rage)\b/i,
      sad: /(?:cry|tears|sorrow|grief|mourn)\b/i,
      happy: /(?:laugh|joy|smile|celebrate|cheer)\b/i,
      suspense: /(?:mystery|unknown|shadow|creep|sneak)\b/i,
      neutral: /(?:said|walked|looked|went|was)\b/i
    };
    for (const [tone, pattern] of Object.entries(tones)) {
      if (pattern.test(text)) return tone;
    }
    return 'neutral';
  }

  private calculateTensionLevel(text: string): number {
    if (!text) return 1;
    const tensionWords = /\b(fight|chase|escape|danger|threat|scream|attack|die|kill|blood)\b/gi;
    const matches = text.match(tensionWords) || [];
    return Math.min(10, Math.max(1, matches.length));
  }

  private generateFallbackSummary(text: string): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= this.opts.maxSummaryWords) return text;
    return words.slice(0, this.opts.maxSummaryWords).join(' ') + '...';
  }

  private createFallbackCompression(scene: Scene, position: number): CompressedScene {
    const text = scene?.text ?? '';
    return {
      id: scene?.id ?? `unknown-${position}`,
      position,
      opening: this.extractOpening(text, this.opts.maxBoundaryWords),
      closing: this.extractClosing(text, this.opts.maxBoundaryWords),
      summary: this.generateFallbackSummary(text),
      metadata: this.extractMetadata(scene)
    };
  }

  // Chapter and act summarization methods following the same patterns...
  private async summarizeChapters(scenes: CompressedScene[]): Promise<Array<{ summary: string; sceneIds: string[] }>> {
    const chapters: Array<{ summary: string; sceneIds: string[] }> = [];
    const size = Math.max(1, this.opts.chapterSize);

    for (let i = 0; i < scenes.length; i += size) {
      const chapterScenes = scenes.slice(i, i + size);
      const sceneIds = chapterScenes.map((s) => s.id);

      // Combine up to three scene summaries for brevity
      const combinedSummary = chapterScenes
        .map((s) => s.summary?.trim() || '')
        .filter(Boolean)
        .slice(0, 3)
        .join(' ');

      // Aggregate key characters
      const keyCharacters = Array.from(
        new Set(chapterScenes.flatMap((s) => s.metadata?.characters ?? []))
      );

      const preface = `Chapter covering ${chapterScenes.length} scene(s).`;
      const charLine = keyCharacters.length ? ` Key characters: ${keyCharacters.join(', ')}.` : '';
      const body = combinedSummary || chapterScenes.map((s) => s.opening).join(' ');
      const summary = this.truncateWords(`${preface}${charLine} ${body}`.trim(), this.opts.maxSummaryWords);

      chapters.push({ summary, sceneIds });
    }

    return chapters;
  }

  private async summarizeActs(
    chapters: Array<{ summary: string; sceneIds: string[] }>,
    _totalScenes: number
  ): Promise<Array<{ summary: string; chapterRange: [number, number] }>> {
    const result: Array<{ summary: string; chapterRange: [number, number] }> = [];
    const n = chapters.length;
    if (n === 0) return result;

    const act1End = Math.max(1, Math.round(n * 0.3));
    const act2End = Math.max(act1End + 1, Math.round(n * 0.8)); // 30% + 50% -> 80%

    const ranges: Array<[number, number]> = [
      [0, Math.min(act1End, n) - 1],
      [Math.min(act1End, n), Math.min(act2End, n) - 1],
      [Math.min(act2End, n), n - 1]
    ];

    const actNames = ['Act I', 'Act II', 'Act III'];

    for (let a = 0; a < ranges.length; a++) {
      const [start, end] = ranges[a];
      if (start > end || start >= n || end < 0) {
        result.push({ summary: `${actNames[a]}: (no content)`, chapterRange: [start, Math.max(end, start)] });
        continue;
      }

      const actChapters = chapters.slice(start, end + 1);
      const combined = actChapters.map((c) => c.summary).join(' ');
      const summary = this.truncateWords(`${actNames[a]}: ${combined}`, this.opts.maxSummaryWords * 2);
      result.push({ summary, chapterRange: [start, end] });
    }

    return result;
  }

  private async createOverview(acts: Array<{ summary: string; chapterRange: [number, number] }>): Promise<string> {
    if (!acts || acts.length === 0) return '';
    const parts = acts.map((a) => a.summary);
    const combined = parts.join(' ');
    return this.truncateWords(combined, this.opts.maxSummaryWords * 3);
  }

  private truncateWords(text: string, maxWords: number): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ') + '...';
  }

  private async tryAISummarize(scene: Scene, previousScenes: Scene[]): Promise<string | undefined> {
    try {
      const readerContext: ReaderKnowledge = {
        knownCharacters: new Set(scene?.characters ?? []),
        establishedTimeline: [],
        revealedPlotPoints: [],
        establishedSettings: []
      };

      const req: AnalysisRequest = {
        scene,
        previousScenes,
        analysisType: 'simple',
        readerContext
      } as AnalysisRequest;

      const res = await this.aiManager.analyzeContinuity(req);
      // Some providers may optionally return a summary in future; accept if present.
      const maybeSummary = (res as unknown as { summary?: string })?.summary;
      if (maybeSummary && typeof maybeSummary === 'string' && maybeSummary.trim().length > 0) {
        return this.truncateWords(maybeSummary, this.opts.maxSummaryWords);
      }

      return undefined;
    } catch (error) {
      console.debug('[ManuscriptCompressor] AI summarization failed; using fallback.', error);
      return undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}