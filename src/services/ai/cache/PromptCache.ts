/* LRU Prompt cache with TTL for AnalysisRequest - memory efficient */

import { AnalysisRequest } from '../types';

type CacheKey = string;

interface CacheEntry {
  key: CacheKey;
  value: unknown;
  expiresAt: number;
  // Doubly-linked list pointers for LRU
  prev?: CacheEntry;
  next?: CacheEntry;
}

/**
 * PromptCache provides a small, in-memory LRU cache with TTL.
 * - Default maxEntries: 100
 * - Default TTL: 5 minutes
 *
 * Stored values are opaque. A stable key is generated from AnalysisRequest.
 */
export class PromptCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  private map: Map<CacheKey, CacheEntry> = new Map();
  private head?: CacheEntry; // Most recently used
  private tail?: CacheEntry; // Least recently used

  private hits = 0;
  private misses = 0;

  constructor(maxEntries = 100, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Return whether the cache contains a fresh value for this request.
   */
  public has(req: AnalysisRequest): boolean {
    const key = this.generateKey(req);
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return false;
    }
    if (Date.now() > entry.expiresAt) {
      this.deleteEntry(entry);
      this.misses++;
      return false;
    }
    // Do not count as hit for has(); hit only when get() returns value
    return true;
  }

  /**
   * Get a cached value if present and not expired. Updates LRU order.
   */
  public get<T>(req: AnalysisRequest): T | undefined {
    const key = this.generateKey(req);
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.deleteEntry(entry);
      this.misses++;
      return undefined;
    }
    this.moveToFront(entry);
    this.hits++;
    return entry.value as T;
  }

  /**
   * Set a value for an AnalysisRequest. Manages TTL and LRU eviction.
   */
  public set<T>(req: AnalysisRequest, value: T): void {
    const key = this.generateKey(req);
    const now = Date.now();
    let entry = this.map.get(key);
    if (entry) {
      entry.value = value;
      entry.expiresAt = now + this.ttlMs;
      this.moveToFront(entry);
      return;
    }
    entry = { key, value, expiresAt: now + this.ttlMs };
    this.map.set(key, entry);
    this.insertAtFront(entry);
    this.evictIfNeeded();
  }

  /**
   * Compute cache stats including hitRate, size, and keys list (for tests/diagnostics).
   */
  public stats(): { hitRate: number; size: number; entries: number } {
    const total = this.hits + this.misses;
    const hitRate = total === 0 ? 0 : this.hits / total;
    return { hitRate, size: this.map.size, entries: this.map.size };
  }

  /**
   * Generate a stable key from AnalysisRequest content without external hashing.
   * Key elements:
   * - scene.id or first 64 chars of scene.text
   * - analysisType
   * - previousScenes: ids summary (up to first 10 ids) and length
   * - readerContext normalized: knownCharacters (sorted array), timeline labels, plot points, settings
   */
  public generateKey(req: AnalysisRequest): string {
    const sceneIdOrText = req.scene.id || req.scene.text.slice(0, 64);
    const prevIds = (req.previousScenes || []).map((s) => s.id || s.text.slice(0, 16));
    const prevSummary = {
      count: prevIds.length,
      first: prevIds.slice(0, 10),
    };

    const knownCharacters = Array.from(req.readerContext.knownCharacters).sort();
    const establishedTimeline = req.readerContext.establishedTimeline.map((t) => ({
      label: t.label,
      when: t.when ?? null,
    }));
    const revealedPlotPoints = [...req.readerContext.revealedPlotPoints].sort();
    const establishedSettings = req.readerContext.establishedSettings.map((l) => ({
      name: l.name,
      id: l.id ?? null,
    }));

    const normalized = {
      scene: sceneIdOrText,
      analysisType: req.analysisType,
      prev: prevSummary,
      reader: {
        knownCharacters,
        establishedTimeline,
        revealedPlotPoints,
        establishedSettings,
      },
    };

    // Use a compact string key. Avoid whitespace to reduce memory.
    return JSON.stringify(normalized);
  }

  // Internal helpers

  private insertAtFront(entry: CacheEntry): void {
    entry.prev = undefined;
    entry.next = this.head;
    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;
    if (!this.tail) {
      this.tail = entry;
    }
  }

  private moveToFront(entry: CacheEntry): void {
    if (this.head === entry) return;
    this.unlink(entry);
    this.insertAtFront(entry);
  }

  private unlink(entry: CacheEntry): void {
    if (entry.prev) {
      entry.prev.next = entry.next;
    }
    if (entry.next) {
      entry.next.prev = entry.prev;
    }
    if (this.head === entry) {
      this.head = entry.next;
    }
    if (this.tail === entry) {
      this.tail = entry.prev;
    }
    entry.prev = undefined;
    entry.next = undefined;
  }

  private deleteEntry(entry: CacheEntry): void {
    this.unlink(entry);
    this.map.delete(entry.key);
  }

  private evictIfNeeded(): void {
    while (this.map.size > this.maxEntries) {
      if (!this.tail) return;
      this.deleteEntry(this.tail);
    }
  }
}

export default PromptCache;