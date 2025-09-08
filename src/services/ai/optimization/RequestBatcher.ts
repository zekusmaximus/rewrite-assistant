// RequestBatcher.ts
// Non-invasive utility for intelligent batch processing with optional de-duplication and concurrency control.
// - Does not alter provider networking; only limits local concurrent runner executions.
// - Safe to import anywhere; pure functions.

import type { AnalysisRequest } from '../types';

export type BatchItem<T> = { key: string; result: T };

export async function batchAnalyze<T>(
  requests: Array<{ req: AnalysisRequest; key: string }>,
  runner: (req: AnalysisRequest) => Promise<T>,
  opts?: { deDupeByKey?: boolean; concurrency?: number }
): Promise<Array<BatchItem<T>>> {
  const deDupe = opts?.deDupeByKey === true;
  const limit = Math.max(1, Math.trunc(opts?.concurrency ?? 3));

  // Preserve original order in output
  const outOrder = requests.map((r) => r.key);

  // Deduplicate by key if requested
  const unique: Array<{ key: string; req: AnalysisRequest }> = [];
  const keyToIndex = new Map<string, number>();
  if (deDupe) {
    for (const item of requests) {
      if (!keyToIndex.has(item.key)) {
        keyToIndex.set(item.key, unique.length);
        unique.push({ key: item.key, req: item.req });
      }
    }
  } else {
    unique.push(...requests);
    unique.forEach((u, idx) => keyToIndex.set(`${idx}:${u.key}`, idx)); // ensure uniqueness
  }

  // Run with concurrency limit
  const results = new Array<BatchItem<T>>(unique.length);
  let inFlight = 0;
  let idx = 0;

  await new Promise<void>((resolve, reject) => {
    const launchNext = () => {
      if (idx >= unique.length && inFlight === 0) {
        resolve();
        return;
      }
      while (inFlight < limit && idx < unique.length) {
        const currentIndex = idx++;
        const { key, req } = unique[currentIndex];
        inFlight++;
        (async () => {
          try {
            const result = await runner(req);
            results[currentIndex] = { key, result };
          } catch (e) {
            reject(e);
            return;
          } finally {
            inFlight--;
            launchNext();
          }
        })();
      }
    };
    launchNext();
  });

  // Map unique results back to all outputs preserving original order
  const keyToResult = new Map<string, T>();
  if (deDupe) {
    for (const r of results) keyToResult.set(r.key, r.result);
    return outOrder.map((k) => ({ key: k, result: keyToResult.get(k)! }));
  }

  // Non-deduped: match 1:1 in order with input by index
  // We used composite keys when not deduping, but output should still be original keys
  // Build from sequential results
  let ptr = 0;
  return requests.map((item) => ({ key: item.key, result: results[ptr++].result }));
}