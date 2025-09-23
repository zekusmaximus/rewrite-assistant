// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ProviderName } from '../../../services/ai/types';

type IPCStatusPayload = {
  available: boolean;
  workingProviders: ProviderName[];
  needsConfiguration: boolean;
};

type AIStatusBridge = {
  onStatus: (cb: (payload: IPCStatusPayload) => void) => () => void;
  onDegraded: (cb: () => void) => () => void;
  onConfigurationNotice: (cb: () => void) => () => void;
  check: () => Promise<void>;
};

function makeBridgeMock(overrides?: Partial<Pick<AIStatusBridge, 'check'>>) {
  const statusListeners = new Set<(p: IPCStatusPayload) => void>();
  const degradedListeners = new Set<() => void>();
  const configListeners = new Set<() => void>();

  let statusSubs = 0;
  let degradedSubs = 0;
  let configSubs = 0;

  const bridge: AIStatusBridge = {
    onStatus: (cb) => {
      statusSubs += 1;
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onDegraded: (cb) => {
      degradedSubs += 1;
      degradedListeners.add(cb);
      return () => degradedListeners.delete(cb);
    },
    onConfigurationNotice: (cb) => {
      configSubs += 1;
      configListeners.add(cb);
      return () => configListeners.delete(cb);
    },
    check: overrides?.check ?? vi.fn().mockResolvedValue(undefined),
  };

  const emitStatus = (payload: IPCStatusPayload) => {
    statusListeners.forEach((cb) => cb(payload));
  };
  const emitDegraded = () => {
    degradedListeners.forEach((cb) => cb());
  };
  const emitConfigNotice = () => {
    configListeners.forEach((cb) => cb());
  };

  return {
    bridge,
    emitStatus,
    emitDegraded,
    emitConfigNotice,
    counts: {
      get status() {
        return statusSubs;
      },
      get degraded() {
        return degradedSubs;
      },
      get config() {
        return configSubs;
      },
    },
  };
}

async function freshStore() {
  // Load a fresh copy of the store module each time to reset module-scope flags.
  const mod = await import('../aiStatusStore');
  return mod;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  // Clear any previous bridge without altering Window typing
  (window as unknown as { ai?: unknown }).ai = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('[typescript.variable useAIStatusStore](src/renderer/stores/aiStatusStore.ts:122) basics', () => {
  it('exposes initial defaults', async () => {
    const { useAIStatusStore } = await freshStore();

    const snap = useAIStatusStore.getState().status;
    expect(snap.available).toBe(false);
    expect(snap.workingProviders).toEqual([]);
    expect(snap.needsConfiguration).toBe(true);
    expect(snap.lastChecked).toBe(0);
  });

  it('[typescript.function requireAI()](src/renderer/stores/aiStatusStore.ts:248) throws with code=AI_UNAVAILABLE when unavailable; does not throw when available', async () => {
    const { useAIStatusStore } = await freshStore();

    const { requireAI, updateStatus } = useAIStatusStore.getState();
    // make unavailable
    updateStatus({ available: false });

    let err: unknown | undefined;
    try {
      requireAI('Continuity Analysis');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { name: string }).name).toBe('AIUnavailableError');
    expect((err as { code: string }).code).toBe('AI_UNAVAILABLE');

    // make available
    updateStatus({ available: true });
    expect(() => useAIStatusStore.getState().requireAI('Continuity Analysis')).not.toThrow();
  });
});

describe('[typescript.function checkStatus()](src/renderer/stores/aiStatusStore.ts:225) behavior', () => {
  it('is debounced (1.5s) and calls bridge.check at most once within window', async () => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const mock = makeBridgeMock();
    (window as unknown as { ai: { aiStatus: AIStatusBridge } }).ai = { aiStatus: mock.bridge };

    const { useAIStatusStore } = await freshStore();

    // First call should invoke check and update lastChecked
    await useAIStatusStore.getState().checkStatus();
    expect((mock.bridge.check as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    const first = useAIStatusStore.getState().status.lastChecked;
    expect(first).toBeGreaterThan(0);

    // Immediate second call should be debounced: no new check
    await useAIStatusStore.getState().checkStatus();
    expect((mock.bridge.check as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    // Advance system time just beyond 1500ms and call again
    vi.setSystemTime(new Date(now.getTime() + 1600));
    await useAIStatusStore.getState().checkStatus();
    expect((mock.bridge.check as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  it('never throws when window.ai is absent', async () => {
    // No bridge
    const { useAIStatusStore } = await freshStore();

    const before = useAIStatusStore.getState().status.lastChecked;
    await expect(useAIStatusStore.getState().checkStatus()).resolves.toBeUndefined();
    const after = useAIStatusStore.getState().status.lastChecked;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('never throws when bridge.check rejects', async () => {
    const mock = makeBridgeMock({
      check: vi.fn().mockRejectedValue(new Error('bridge failure')),
    });
    (window as unknown as { ai: { aiStatus: AIStatusBridge } }).ai = { aiStatus: mock.bridge };

    const { useAIStatusStore } = await freshStore();

    await expect(useAIStatusStore.getState().checkStatus()).resolves.toBeUndefined();
    expect(mock.bridge.check).toHaveBeenCalledTimes(1);
  });
});

describe('[typescript.function initIPC()](src/renderer/stores/aiStatusStore.ts:142) idempotency and event application', () => {
  it('subscribes once, applies valid onStatus, ignores malformed payload, handles onDegraded', async () => {
    // fresh bridge
    const mock = makeBridgeMock();
    (window as unknown as { ai: { aiStatus: AIStatusBridge } }).ai = { aiStatus: mock.bridge };

    const { useAIStatusStore } = await freshStore();

    // Call twice to test idempotency
    useAIStatusStore.getState().initIPC();
    useAIStatusStore.getState().initIPC();

    // Only one subscription should have been made to each channel
    expect(mock.counts.status).toBe(1);
    expect(mock.counts.degraded).toBe(1);
    expect(mock.counts.config).toBe(1);

    // Emit valid status payload
    const t1 = new Date('2025-01-01T00:00:10.000Z').getTime();
    const spyNow = vi.spyOn(Date, 'now').mockReturnValue(t1);

    mock.emitStatus({
      available: true,
      workingProviders: ['openai'],
      needsConfiguration: false,
    });

    const afterValid = useAIStatusStore.getState().status;
    expect(afterValid.available).toBe(true);
    expect(afterValid.workingProviders).toEqual(['openai']);
    expect(afterValid.needsConfiguration).toBe(false);
    expect(afterValid.lastChecked).toBe(t1);

    // Emit malformed payload - should be ignored without throw
    spyNow.mockReturnValue(t1 + 5000);
    // @ts-expect-error intentionally wrong shape
    mock.emitStatus({ bad: true });

    const afterInvalid = useAIStatusStore.getState().status;
    // unchanged from previous (specifically lastChecked unchanged)
    expect(afterInvalid.lastChecked).toBe(t1);
    expect(afterInvalid.available).toBe(true);

    // onDegraded should set available=false and needsConfiguration=true and clear providers
    const t2 = t1 + 10_000;
    spyNow.mockReturnValue(t2);
    mock.emitDegraded();

    const afterDegraded = useAIStatusStore.getState().status;
    expect(afterDegraded.available).toBe(false);
    expect(afterDegraded.needsConfiguration).toBe(true);
    expect(afterDegraded.workingProviders).toEqual([]);
    expect(afterDegraded.lastChecked).toBe(t2);

    spyNow.mockRestore();
  });
});