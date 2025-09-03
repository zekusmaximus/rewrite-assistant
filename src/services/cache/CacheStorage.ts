/**
 * CacheStorage
 *
 * Two-tier cache:
 *  - L1: in-memory LRU (lru-cache if available; Map-based fallback)
 *  - L2: SQLite via better-sqlite3 (optional, dynamic require to avoid bundler/runtime issues)
 *
 * Notes:
 *  - 24h TTL enforced at read-time for both tiers.
 *  - L2 is best-effort. If unavailable or errors occur, storage operates in L1-only mode.
 *  - JSON serialization must handle ReaderKnowledge.knownCharacters (Set) safely.
 *  - Provides public underscore test hooks that delegate to private helpers.
 */

import path from 'path';
import type { CachedAnalysis, CacheStats } from './types';

// Duplication of TTL to avoid coupling/circular import. Keep in sync with AnalysisCache.
const TTL_MS = 24 * 60 * 60 * 1000;
const L1_MAX = 200;
const L2_MAX_ROWS = 1000;

// Dynamic require helper
const dynamicRequire: NodeRequire | null = (() => {
  try {
    // eslint-disable-next-line no-eval
    return eval('require');
  } catch {
    return null;
  }
})();

type L1Value = CachedAnalysis;
type L1Key = string;

/**
 * Minimal LRU compatible interface used internally so we can swap implementations.
 */
interface LruLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, val: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
  /** Optional keys iterator for maintenance/invalidation if available. */
  keys?(): IterableIterator<K>;
}

/**
 * Map-based fallback LRU with simple recency management:
 *  - get: reinsert to end
 *  - set: evict first inserted if over capacity
 */
class SimpleMapLRU<K, V> implements LruLike<K, V> {
  private map = new Map<K, V>();
  private max: number;
  constructor(max: number) { this.max = max; }
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.max) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
  }
  has(key: K): boolean { return this.map.has(key); }
  delete(key: K): boolean { return this.map.delete(key); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
  keys(): IterableIterator<K> { return this.map.keys(); }
}

// Attempt to build an L1 cache using lru-cache if available.
function createL1(max: number): LruLike<L1Key, L1Value> {
  try {
    if (dynamicRequire) {
      const LRU = dynamicRequire('lru-cache');
      if (LRU && LRU.default) {
        // lru-cache v7+ exports default
        const lru = new LRU.default({ max });
        return {
          get: (k: L1Key) => lru.get(k),
          set: (k: L1Key, v: L1Value) => { lru.set(k, v); },
          has: (k: L1Key) => lru.has(k),
          delete: (k: L1Key) => lru.delete(k),
          clear: () => lru.clear(),
          get size() { return lru.size; },
          keys: () => lru.keys(),
        };
      } else if (LRU) {
        // older versions
        const lru = new LRU({ max });
        return {
          get: (k: L1Key) => lru.get(k),
          set: (k: L1Key, v: L1Value) => { lru.set(k, v); },
          has: (k: L1Key) => lru.has(k),
          delete: (k: L1Key) => lru.delete(k),
          clear: () => lru.clear(),
          get size() { return lru.size; },
          keys: () => lru.keys(),
        };
      }
    }
  } catch {
    // ignore
  }
  return new SimpleMapLRU<L1Key, L1Value>(max);
}

// SQLite (better-sqlite3) dynamic load
type BetterSqliteDatabase = any;

function resolveDbPath(): string {
  // Try Electron userData
  try {
    if (dynamicRequire) {
      const electron = dynamicRequire('electron');
      const userData =
        electron?.app?.getPath?.('userData') ||
        (electron as any)?.remote?.app?.getPath?.('userData');
      if (typeof userData === 'string' && userData.length > 0) {
        return path.join(userData, 'analysis-cache.sqlite');
      }
    }
  } catch {
    // ignore
  }
  // Fallback to CWD
  return path.join(process.cwd(), 'analysis-cache.sqlite');
}

// Helpers to serialize/deserialize CachedAnalysis safely for DB storage
function serializeCachedAnalysis(value: CachedAnalysis): string {
  try {
    // Clone and convert ReaderKnowledge.knownCharacters(Set) -> Array to ensure JSON-safe
    const clone: any = JSON.parse(JSON.stringify(value, (_k, v) => {
      // Basic stable conversion (structures already JSON-safe except Set)
      return v;
    }));
    if (clone?.analysis?.readerContext?.knownCharacters instanceof Set) {
      clone.analysis.readerContext.knownCharacters = Array.from(clone.analysis.readerContext.knownCharacters);
    } else if (Array.isArray(clone?.analysis?.readerContext?.knownCharacters)) {
      // already array, ok
    } else if (value?.analysis?.readerContext?.knownCharacters instanceof Set) {
      clone.analysis.readerContext.knownCharacters = Array.from(value.analysis.readerContext.knownCharacters);
    }
    return JSON.stringify(clone);
  } catch {
    // As a last resort, do a manual shallow conversion for knownCharacters
    try {
      const shallow: any = {
        ...value,
        analysis: {
          ...value.analysis,
          readerContext: {
            ...value.analysis.readerContext,
            knownCharacters: Array.from(value.analysis.readerContext.knownCharacters || []),
          },
        },
      };
      return JSON.stringify(shallow);
    } catch {
      // give up but avoid throwing
      return '';
    }
  }
}

function deserializeCachedAnalysis(json: string): CachedAnalysis | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed?.analysis?.readerContext?.knownCharacters && Array.isArray(parsed.analysis.readerContext.knownCharacters)) {
      parsed.analysis.readerContext.knownCharacters = new Set<string>(parsed.analysis.readerContext.knownCharacters);
    }
    return parsed as CachedAnalysis;
  } catch {
    return null;
  }
}

interface SqliteRow {
  cache_key: string;
  analysis_data: string;
  semantic_hash: string;
  cached_at: number;
  last_accessed: number;
  hit_count: number;
  scene_id?: string | null;
  position?: number | null;
}

export default class CacheStorage {
  private l1: LruLike<L1Key, L1Value>;
  private l2Db: BetterSqliteDatabase | null = null;
  private l2Available = false;

  // In-memory metadata for L1 invalidation
  private keyMeta = new Map<string, { sceneId?: string; position?: number }>();

  // Storage-level approximate stats
  private storageHits = 0;
  private storageMisses = 0;

  constructor() {
    this.l1 = createL1(L1_MAX);
  }

  async init(): Promise<void> {
    // initialize SQLite if possible
    try {
      let Database: any = null;
      if (dynamicRequire) {
        try {
          Database = dynamicRequire('better-sqlite3');
        } catch {
          Database = null;
        }
      }

      if (Database) {
        const dbPath = resolveDbPath();
        this.l2Db = new Database(dbPath);
        this.l2Available = true;
        // Create schema
        this.l2Db
          .prepare(
            `CREATE TABLE IF NOT EXISTS analysis_cache (
              cache_key TEXT PRIMARY KEY,
              analysis_data TEXT NOT NULL,
              semantic_hash TEXT NOT NULL,
              cached_at INTEGER NOT NULL,
              last_accessed INTEGER NOT NULL,
              hit_count INTEGER DEFAULT 0,
              scene_id TEXT,
              position INTEGER
            )`,
          )
          .run();

        this.l2Db.prepare(`CREATE INDEX IF NOT EXISTS idx_scene_id ON analysis_cache(scene_id)`).run();
        this.l2Db.prepare(`CREATE INDEX IF NOT EXISTS idx_position ON analysis_cache(position)`).run();
        this.l2Db.prepare(`CREATE INDEX IF NOT EXISTS idx_last_accessed ON analysis_cache(last_accessed)`).run();
      }
    } catch (err) {
      // Disable L2 for session
      this.l2Available = false;
      this.l2Db = null;
      // eslint-disable-next-line no-console
      console.warn('[CacheStorage] SQLite unavailable, continuing with memory-only.', err);
    }
  }

  // Public API

  async get(cacheKey: string): Promise<CachedAnalysis | null> {
    try {
      // L1
      const fromMem = this.getFromMemory(cacheKey);
      if (fromMem) {
        this.storageHits++;
        this.bumpAccess(cacheKey, /*l1*/ true, /*l2*/ true);
        return fromMem;
      }
      this.storageMisses++;

      // L2
      const row = await this.getRowFromSQLite(cacheKey);
      if (row) {
        const now = Date.now();
        if (now - row.cached_at > TTL_MS) {
          // expired
          await this.deleteFromSQLite(cacheKey);
          return null;
        }
        const parsed = deserializeCachedAnalysis(row.analysis_data);
        if (!parsed) {
          // corruption
          await this.deleteFromSQLite(cacheKey);
          return null;
        }
        // hydrate L1 and metadata
        this.setToMemory(cacheKey, parsed);
        this.keyMeta.set(cacheKey, { sceneId: row.scene_id ?? undefined, position: row.position ?? undefined });
        this.storageHits++;
        this.bumpAccess(cacheKey, /*l1*/ true, /*l2*/ true);
        return parsed;
      }
      return null;
    } catch {
      // Never break caller flow
      return null;
    }
  }

  // meta is optional; if provided, allows L2 to store scene_id/position for targeted invalidation.
  async set(cacheKey: string, analysis: CachedAnalysis, meta?: { sceneId?: string; position?: number }): Promise<void> {
    try {
      // L1
      this.setToMemory(cacheKey, analysis);
      if (meta) this.keyMeta.set(cacheKey, { sceneId: meta.sceneId, position: meta.position });

      // L2
      await this._setToSQLite(cacheKey, analysis, meta);
      await this.cleanupExpired();
      await this.enforceL2Capacity();
    } catch (err) {
      // Disable L2 on persistent failure, do not throw
      // eslint-disable-next-line no-console
      console.warn('[CacheStorage] set failed, proceeding with memory-only.', err);
      this.l2Available = false;
      this.l2Db = null;
    }
  }

  async getStats(): Promise<CacheStats> {
    let l2Count = 0;
    if (this.l2Available && this.l2Db) {
      try {
        const row = this.l2Db.prepare('SELECT COUNT(*) as cnt FROM analysis_cache').get();
        l2Count = typeof row?.cnt === 'number' ? row.cnt : 0;
      } catch {
        // ignore
      }
    }

    const totalGets = this.storageHits + this.storageMisses;
    const hitRate = totalGets > 0 ? (this.storageHits / totalGets) * 100 : 0;

    return {
      hitRate,
      size: (this.l1?.size ?? 0) + l2Count,
      totalHits: this.storageHits,
      totalMisses: this.storageMisses,
      avgHitTime: 0,
      avgGenerationTime: 0,
    };
    }

  async clear(): Promise<void> {
    try {
      this.l1.clear();
      this.keyMeta.clear();
      if (this.l2Available && this.l2Db) {
        this.l2Db.prepare('DELETE FROM analysis_cache').run();
      }
    } catch {
      // ignore
    }
  }

  // Private L1 helpers

  private getFromMemory(cacheKey: string): CachedAnalysis | null {
    try {
      if (!this.l1?.has(cacheKey)) return null;
      const val = this.l1.get(cacheKey);
      if (!val) return null;
      const now = Date.now();
      // Enforce TTL against creation time
      if (now - val.cachedAt > TTL_MS) {
        this.l1.delete(cacheKey);
        this.keyMeta.delete(cacheKey);
        return null;
      }
      return val;
    } catch {
      return null;
    }
  }

  private setToMemory(cacheKey: string, analysis: CachedAnalysis): void {
    try {
      this.l1.set(cacheKey, analysis);
    } catch {
      // ignore
    }
  }

  // Private L2 helpers

  private async getRowFromSQLite(cacheKey: string): Promise<SqliteRow | null> {
    if (!this.l2Available || !this.l2Db) return null;
    try {
      const row = this.l2Db
        .prepare(
          `SELECT cache_key, analysis_data, semantic_hash, cached_at, last_accessed, hit_count, scene_id, position
           FROM analysis_cache WHERE cache_key = ?`,
        )
        .get(cacheKey) as SqliteRow | undefined;
      return row || null;
    } catch (err) {
      // Disable L2 on error
      this.l2Available = false;
      this.l2Db = null;
      // eslint-disable-next-line no-console
      console.warn('[CacheStorage] getRowFromSQLite failed, disabling L2.', err);
      return null;
    }
  }

  // Test hook: publicly exposed wrapper
  public async _getFromSQLite(cacheKey: string): Promise<CachedAnalysis | null> {
    const row = await this.getRowFromSQLite(cacheKey);
    if (!row) return null;
    const parsed = deserializeCachedAnalysis(row.analysis_data);
    if (!parsed) return null;
    return parsed;
  }

  private async setToSQLite(cacheKey: string, analysis: CachedAnalysis, meta?: { sceneId?: string; position?: number }): Promise<void> {
    if (!this.l2Available || !this.l2Db) return;
    try {
      const payload = serializeCachedAnalysis(analysis);
      if (!payload) return; // skip if serialization failed
      const now = Date.now();
      const sceneId = meta?.sceneId ?? null;
      const position = typeof meta?.position === 'number' ? meta!.position : null;

      this.l2Db
        .prepare(
          `INSERT INTO analysis_cache (cache_key, analysis_data, semantic_hash, cached_at, last_accessed, hit_count, scene_id, position)
           VALUES (@cache_key, @analysis_data, @semantic_hash, @cached_at, @last_accessed, @hit_count, @scene_id, @position)
           ON CONFLICT(cache_key) DO UPDATE SET
             analysis_data = excluded.analysis_data,
             semantic_hash = excluded.semantic_hash,
             cached_at = excluded.cached_at,
             last_accessed = excluded.last_accessed,
             scene_id = COALESCE(excluded.scene_id, analysis_cache.scene_id),
             position = COALESCE(excluded.position, analysis_cache.position)`,
        )
        .run({
          cache_key: cacheKey,
          analysis_data: payload,
          semantic_hash: analysis.semanticHash,
          cached_at: analysis.cachedAt,
          last_accessed: analysis.lastAccessed,
          hit_count: analysis.hitCount,
          scene_id: sceneId,
          position: position,
        });
    } catch (err) {
      // Disable L2 on persistent failure
      this.l2Available = false;
      this.l2Db = null;
      // eslint-disable-next-line no-console
      console.warn('[CacheStorage] setToSQLite failed, disabling L2.', err);
    }
  }

  // Test hook: publicly exposed wrapper
  public async _setToSQLite(cacheKey: string, analysis: CachedAnalysis, meta?: { sceneId?: string; position?: number }): Promise<void> {
    await this.setToSQLite(cacheKey, analysis, meta);
  }

  private async deleteFromSQLite(cacheKey: string): Promise<void> {
    if (!this.l2Available || !this.l2Db) return;
    try {
      this.l2Db.prepare('DELETE FROM analysis_cache WHERE cache_key = ?').run(cacheKey);
    } catch (err) {
      // Disable L2 on error
      this.l2Available = false;
      this.l2Db = null;
      // eslint-disable-next-line no-console
      console.warn('[CacheStorage] deleteFromSQLite failed, disabling L2.', err);
    }
  }

  private async enforceL2Capacity(): Promise<void> {
    if (!this.l2Available || !this.l2Db) return;
    try {
      const countRow = this.l2Db.prepare('SELECT COUNT(*) as cnt FROM analysis_cache').get();
      const cnt = typeof countRow?.cnt === 'number' ? countRow.cnt : 0;
      const excess = cnt - L2_MAX_ROWS;
      if (excess > 0) {
        this.l2Db
          .prepare(
            `DELETE FROM analysis_cache
             WHERE cache_key IN (
               SELECT cache_key FROM analysis_cache
               ORDER BY last_accessed ASC
               LIMIT ?
             )`,
          )
          .run(excess);
      }
    } catch (err) {
      // ignore; not critical
      // eslint-disable-next-line no-console
      console.warn('[CacheStorage] enforceL2Capacity warning:', err);
    }
  }

  private async cleanupExpired(): Promise<void> {
    if (!this.l2Available || !this.l2Db) return;
    try {
      const cutoff = Date.now() - TTL_MS;
      this.l2Db.prepare('DELETE FROM analysis_cache WHERE cached_at < ?').run(cutoff);
    } catch (err) {
      // ignore
      // eslint-disable-next-line no-console
      console.warn('[CacheStorage] cleanupExpired warning:', err);
    }
  }

  private bumpAccess(cacheKey: string, bumpL1: boolean, bumpL2: boolean): void {
    const now = Date.now();
    if (bumpL1) {
      const val = this.l1.get(cacheKey);
      if (val) {
        const bumped: CachedAnalysis = {
          ...val,
          lastAccessed: now,
          hitCount: (val.hitCount || 0) + 1,
        };
        this.l1.set(cacheKey, bumped);
      }
    }
    if (bumpL2 && this.l2Available && this.l2Db) {
      try {
        this.l2Db
          .prepare('UPDATE analysis_cache SET last_accessed = ?, hit_count = hit_count + 1 WHERE cache_key = ?')
          .run(now, cacheKey);
      } catch {
        // ignore
      }
    }
  }

  // Private invalidation helpers (invoked by AnalysisCache using symbolic helper call with "as any")

  private deleteBySceneId(sceneId: string): number {
    let removed = 0;
    // L1 by metadata map
    try {
      for (const [key, meta] of this.keyMeta.entries()) {
        if (meta.sceneId === sceneId) {
          if (this.l1.delete(key)) removed++;
          this.keyMeta.delete(key);
        }
      }
    } catch {
      // ignore
    }
    // L2
    try {
      if (this.l2Available && this.l2Db) {
        const info = this.l2Db.prepare('DELETE FROM analysis_cache WHERE scene_id = ?').run(sceneId);
        removed += info?.changes ?? 0;
      }
    } catch {
      // ignore
    }
    return removed;
  }

  private deleteByPosition(position: number): number {
    let removed = 0;
    // L1 by metadata map
    try {
      for (const [key, meta] of this.keyMeta.entries()) {
        if (typeof meta.position === 'number' && meta.position === position) {
          if (this.l1.delete(key)) removed++;
          this.keyMeta.delete(key);
        }
      }
    } catch {
      // ignore
    }
    // L2
    try {
      if (this.l2Available && this.l2Db) {
        const info = this.l2Db.prepare('DELETE FROM analysis_cache WHERE position = ?').run(position);
        removed += info?.changes ?? 0;
      }
    } catch {
      // ignore
    }
    return removed;
  }

  // Public underscore test hooks for memory
  public _getFromMemory(cacheKey: string): CachedAnalysis | null {
    return this.getFromMemory(cacheKey);
  }
}