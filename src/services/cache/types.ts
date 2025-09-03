// Cache module shared types. These are scoped to the cache subsystem and
// reference canonical application types from src/shared/types.ts to avoid duplication.

import type { ContinuityAnalysis } from '../../shared/types';

// Represents a single cached analysis record stored in L1/L2.
export interface CachedAnalysis {
  analysis: ContinuityAnalysis;
  semanticHash: string;
  cachedAt: number;       // epoch ms when cached
  hitCount: number;       // number of times retrieved from cache
  lastAccessed: number;   // epoch ms for LRU and TTL checks
}

// Semantic cache key derived from meaning rather than raw text.
// The semanticSignature encapsulates content + context + reader knowledge.
export interface CacheKey {
  sceneId: string;
  position: number;
  semanticSignature: {
    sceneFingerprint: string;
    contextFingerprint: string;
    readerKnowledgeFingerprint: string;
  };
}

// High-level cache statistics aggregated by the coordinator.
export interface CacheStats {
  hitRate: number;            // percentage in [0, 100]
  size: number;               // approximate entries across tiers
  totalHits: number;
  totalMisses: number;
  avgHitTime: number;         // ms, moving average for cache hits
  avgGenerationTime: number;  // ms, moving average for analysis generation
}

export type { ContinuityAnalysis };