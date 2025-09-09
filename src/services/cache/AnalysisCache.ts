/**
 * AnalysisCache
 *
 * High-level coordinator that composes SemanticHasher and CacheStorage.
 * - Builds stable, semantic cache keys
 * - Tracks simple performance stats
 * - Delegates two-tier storage to CacheStorage
 * - Exposes test hooks
 *
 * Note: We intentionally avoid integrating into other subsystems in this subtask.
 */

import { sha256 } from 'js-sha256';
import type { Scene, ReaderKnowledge, ContinuityAnalysis } from '../../shared/types';
import type { CacheKey, CachedAnalysis, CacheStats } from './types';
import SemanticHasher from './SemanticHasher';
import CacheStorage from './CacheStorage';

// TTL duplicated here to avoid circular import
const TTL_MS = 24 * 60 * 60 * 1000;

type StorageInt = {
 deleteBySceneId?: (id: string) => void;
 deleteByPosition?: (pos: number) => void;
 _getFromMemory?: (k: string) => unknown;
 l1?: { keys?: () => IterableIterator<string>; has?: (k: string) => boolean };
 l2Db?: { prepare: (sql: string) => unknown };
 cleanupExpired?: () => Promise<void> | void;
};

// Stable stringify with key sorting to ensure deterministic hashing
function stableStringify(value: unknown): string {
 const seen = new WeakSet<object>();
 const sorter = (_key: string, val: unknown) => {
   if (val && typeof val === 'object') {
     if (seen.has(val as object)) return undefined;
     seen.add(val as object);
     if (Array.isArray(val)) {
       return (val as unknown[]).map((v) => (typeof v === 'object' ? JSON.parse(stableStringify(v)) : v));
     }
     const rec = val as Record<string, unknown>;
     const keys = Object.keys(rec).sort();
     const sorted: Record<string, unknown> = {};
     for (const k of keys) {
       const v = rec[k];
       if (v !== undefined) sorted[k] = v;
     }
     return sorted;
   }
   return val as unknown;
 };
 return JSON.stringify(value, sorter as (key: string, value: unknown) => unknown);
}

function sha256Hex(input: string): string {
  return sha256(input);
}

export default class AnalysisCache {
  private hasher: SemanticHasher;
  private storage: CacheStorage;

  // Stats
  private totalHits = 0;
  private totalMisses = 0;
  private avgHitTimeMs = 0;
  private hitSamples = 0;
  private avgGenerationTimeMs = 0;
  private generationSamples = 0;

  // Storage stats snapshot for synchronous getStats()
  private lastKnownSize = 0;
  private getCounterSinceLastRefresh = 0;

  constructor() {
    this.hasher = new SemanticHasher();
    this.storage = new CacheStorage();
  }

  async init(): Promise<void> {
    await this.storage.init();
    // Asynchronously refresh initial storage stats snapshot
    this.refreshStorageStats().catch(() => {});
  }

  // Test hook: return final string cache key used in storage for a given input
  public generateCacheKey(scene: Scene, position: number, previousScenes: Scene[], readerContext: ReaderKnowledge): string {
    const keyObj = this.hasher.generateCacheKey(scene, position, previousScenes, readerContext);
    return this.hashCacheKeyObject(keyObj);
  }

  async get(
    scene: Scene,
    position: number,
    previousScenes: Scene[],
    readerContext: ReaderKnowledge,
  ): Promise<ContinuityAnalysis | null> {
    const t0 = Date.now();

    const keyObj = this.hasher.generateCacheKey(scene, position, previousScenes, readerContext);
    const storageKey = this.hashCacheKeyObject(keyObj);

    const found = await this.storage.get(storageKey);
    if (found) {
      const dt = Date.now() - t0;
      this.totalHits++;
      this.avgHitTimeMs = (this.avgHitTimeMs * this.hitSamples + dt) / (this.hitSamples + 1);
      this.hitSamples++;

      // opportunistically refresh size every ~20 gets to keep getStats() light/sync
      this.getCounterSinceLastRefresh++;
      if (this.getCounterSinceLastRefresh >= 20) {
        this.getCounterSinceLastRefresh = 0;
        this.refreshStorageStats().catch(() => {});
      }

      return found.analysis;
    }

    this.totalMisses++;
    // Opportunistic refresh on misses too (less frequently)
    if ((this.totalMisses + this.totalHits) % 25 === 0) {
      this.refreshStorageStats().catch(() => {});
    }
    return null;
  }

  async set(
    scene: Scene,
    position: number,
    previousScenes: Scene[],
    readerContext: ReaderKnowledge,
    analysis: ContinuityAnalysis,
    generationMs?: number, // optional timing hook to update avgGenerationTime
  ): Promise<void> {
    const keyObj = this.hasher.generateCacheKey(scene, position, previousScenes, readerContext);
    const storageKey = this.hashCacheKeyObject(keyObj);

    const semanticHash = sha256Hex(stableStringify(keyObj.semanticSignature));
    const now = Date.now();

    const record: CachedAnalysis = {
      analysis,
      semanticHash,
      cachedAt: now,
      lastAccessed: now,
      hitCount: 0,
    };

    // Best-effort cache write
    await this.storage.set(storageKey, record, { sceneId: scene.id, position });

    // Refresh size snapshot in the background
    this.refreshStorageStats().catch(() => {});

    // Update avg generation time if provided
    if (typeof generationMs === 'number' && isFinite(generationMs) && generationMs >= 0) {
      this.avgGenerationTimeMs = (this.avgGenerationTimeMs * this.generationSamples + generationMs) / (this.generationSamples + 1);
      this.generationSamples++;
    }
  }

  async invalidateScene(sceneId: string): Promise<void> {
    try {
      const S = this.storage as unknown as StorageInt;
      // Leverage storage's targeted invalidation (handles L1 via metadata and L2 via index)
      S.deleteBySceneId?.(sceneId);
    } catch {
      // swallow
    }
    // refresh size snapshot afterwards
    this.refreshStorageStats().catch(() => {});
  }

  async invalidatePosition(position: number): Promise<void> {
    try {
      const S = this.storage as unknown as StorageInt;
      S.deleteByPosition?.(position);
    } catch {
      // swallow
    }
    this.refreshStorageStats().catch(() => {});
  }

  async warmCache(scenes: Scene[]): Promise<void> {
    // Pre-compute keys to warm NLP/hash code paths and any internal caches.
    // We use lightweight reader context placeholder and a simple previousScenes window.
    const sorted = [...scenes].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const emptyReader: ReaderKnowledge = {
      knownCharacters: new Set<string>(),
      establishedTimeline: [],
      revealedPlotPoints: [],
      establishedSettings: [],
    };
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const prev = sorted.slice(0, i).slice(-5); // last 5 prior for warming symmetry
      // Compute but do nothing with the result
      this.hasher.generateCacheKey(s, s.position ?? i, prev, emptyReader);
    }
  }

  getStats(): CacheStats {
    const total = this.totalHits + this.totalMisses;
    const hitRate = total > 0 ? (this.totalHits / total) * 100 : 0;

    return {
      hitRate,
      size: this.lastKnownSize, // snapshot maintained asynchronously
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      avgHitTime: this.avgHitTimeMs,
      avgGenerationTime: this.avgGenerationTimeMs,
    };
  }

  /**
   * Cleanup expired entries across tiers. Returns count removed where measurable.
   * - L1: best-effort by probing entries (if keys are accessible).
   * - L2: delete rows older than TTL.
   */
  async cleanup(): Promise<number> {
    let removed = 0;

    // L1 sweep (best-effort; relies on internal structures being present)
    try {
      const S = this.storage as unknown as StorageInt;
      const l1 = S.l1;
      if (l1?.keys) {
        const keys = Array.from(l1.keys());
        for (const k of keys) {
          // Trigger TTL check path; _getFromMemory deletes expired entries
          const beforeHas = l1.has ? l1.has(k) : false;
          const v = S._getFromMemory?.(k);
          if (beforeHas && !v) removed++;
        }
      }
    } catch {
      // ignore
    }

    // L2 cleanup (precise)
    try {
      const S = this.storage as unknown as StorageInt;
      const db = S.l2Db;
      if (db) {
        const cutoff = Date.now() - TTL_MS;
        const stmtSel = db.prepare('SELECT COUNT(*) as cnt FROM analysis_cache WHERE cached_at < ?') as unknown;
        let row: unknown = undefined;
        if (stmtSel && typeof stmtSel === 'object') {
          const sel = stmtSel as { get?: (...args: unknown[]) => unknown };
          row = sel.get?.(cutoff);
        }
        let stale = 0;
        if (row && typeof row === 'object') {
          const rec = row as Record<string, unknown>;
          const cnt = rec['cnt'];
          stale = typeof cnt === 'number' ? cnt : 0;
        }
        const stmtDel = db.prepare('DELETE FROM analysis_cache WHERE cached_at < ?') as unknown;
        if (stmtDel && typeof stmtDel === 'object') {
          const del = stmtDel as { run?: (...args: unknown[]) => unknown };
          del.run?.(cutoff);
        }
        removed += stale;
      } else {
        // If no DB, still allow storage to run its internal cleanup if available
        await S.cleanupExpired?.();
      }
    } catch {
      // ignore
    }

    // Refresh stats snapshot
    await this.refreshStorageStats().catch(() => {});
    return removed;
  }

  /**
   * Clear both cache tiers via underlying storage and reset in-memory stats/snapshots.
   * Resilient: swallows storage errors but always resets metrics to avoid stale values.
   */
  public async clear(): Promise<void> {
    try {
      await this.storage.clear();
    } catch {
      // swallow storage errors
    } finally {
      // Reset AnalysisCache in-memory stats and counters
      this.totalHits = 0;
      this.totalMisses = 0;
      this.avgHitTimeMs = 0;
      this.hitSamples = 0;
      this.avgGenerationTimeMs = 0;
      this.generationSamples = 0;

      // Reset snapshots/counters so getStats() reflects a cleared state immediately
      this.lastKnownSize = 0;
      this.getCounterSinceLastRefresh = 0;
    }
  }

  // Internal helpers

  private hashCacheKeyObject(keyObj: CacheKey): string {
    const json = stableStringify(keyObj);
    return sha256Hex(json);
  }

  private async refreshStorageStats(): Promise<void> {
    try {
      const stats = await this.storage.getStats();
      this.lastKnownSize = stats.size;
    } catch {
      // ignore
    }
  }
}