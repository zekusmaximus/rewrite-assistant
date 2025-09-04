// src/services/rewrite/DiffEngine.ts
import type { DiffSegment } from '../../shared/types';

interface DiffOptions {
  granularity: 'character' | 'word' | 'sentence';
  includeReasons: boolean;
}

class DiffEngine {
  /**
   * Generate diff segments between original and rewritten text.
   * Phase 3.1 basic implementation — can be enhanced later.
   */
  static generateDiff(
    original: string,
    rewritten: string,
    options: DiffOptions = { granularity: 'word', includeReasons: true }
  ): DiffSegment[] {
    if (original === rewritten) {
      return [
        {
          type: 'unchanged',
          text: original,
          startIndex: 0,
          endIndex: original.length,
        },
      ];
    }

    if (!original && rewritten) {
      return [
        {
          type: 'added',
          text: rewritten,
          startIndex: 0,
          endIndex: rewritten.length,
          reason: options.includeReasons ? 'New text added' : undefined,
        },
      ];
    }

    if (original && !rewritten) {
      return [
        {
          type: 'removed',
          text: original,
          startIndex: 0,
          endIndex: original.length,
          reason: options.includeReasons ? 'Text removed' : undefined,
        },
      ];
    }

    // Minimal placeholder: represent as full replacement
    const segments: DiffSegment[] = [
      {
        type: 'removed',
        text: original,
        startIndex: 0,
        endIndex: original.length,
        reason: options.includeReasons ? 'Original text replaced' : undefined,
      },
      {
        type: 'added',
        text: rewritten,
        startIndex: 0,
        endIndex: rewritten.length,
        reason: options.includeReasons ? 'Rewritten text inserted' : undefined,
      },
    ];

    return segments;
    }

  /**
   * Generate human-readable summary of changes.
   */
  static summarizeChanges(segments: DiffSegment[]): string {
    const added = segments.filter((s) => s.type === 'added').length;
    const removed = segments.filter((s) => s.type === 'removed').length;
    const unchanged = segments.filter((s) => s.type === 'unchanged').length;

    const parts: string[] = [];
    if (added > 0) parts.push(`${added} additions`);
    if (removed > 0) parts.push(`${removed} deletions`);
    if (unchanged > 0) parts.push(`${unchanged} unchanged sections`);

    return parts.join(', ') || 'No changes';
  }

  /**
   * Calculate similarity percentage between texts.
   * Simple character-length ratio placeholder for Phase 3.1.
   */
  static calculateSimilarity(original: string, rewritten: string): number {
    if (original === rewritten) return 100;
    if (!original && !rewritten) return 100;
    if (!original || !rewritten) return 0;

    const maxLen = Math.max(original.length, rewritten.length);
    const minLen = Math.min(original.length, rewritten.length);

    return Math.round((minLen / maxLen) * 100);
  }
}

export default DiffEngine;
export type { DiffOptions };