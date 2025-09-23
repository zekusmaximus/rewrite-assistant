// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stores
import { useAIStatusStore } from '../../../stores/aiStatusStore';

// ---- Mocks (must be declared before importing SUT) ----
vi.mock('../../settings/stores/useSettingsStore', () => {
  const __openSettingsSpy = vi.fn();
  (globalThis as unknown as { __openSettingsSpy: ReturnType<typeof vi.fn> }).__openSettingsSpy =
    __openSettingsSpy;

  const useSettingsStore = ((selector?: (s: { openSettings: () => void }) => unknown) => {
    const state = { openSettings: __openSettingsSpy };
    return typeof selector === 'function' ? selector(state) : state;
  }) as unknown as typeof import('../../settings/stores/useSettingsStore').useSettingsStore;

  return {
    __esModule: true,
    useSettingsStore,
  };
});

// Mock analysis hook to avoid triggering real analysis logic and to spy downstream calls
vi.mock('../hooks/useAnalysis', () => {
  const __analyzeMovedScenesSpy = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { __analyzeMovedScenesSpy: ReturnType<typeof vi.fn> }).__analyzeMovedScenesSpy =
    __analyzeMovedScenesSpy;

  const useAnalysis = () => ({
    analyzeMovedScenes: __analyzeMovedScenesSpy,
    getSceneIssues: (_sceneId: string) => [],
    getIssueCountsByType: (_ids?: string[]) => ({
      pronoun: 0,
      timeline: 0,
      character: 0,
      plot: 0,
      engagement: 0,
    }),
    clearIssues: (_sceneId?: string) => {},
    toggleIssueType: (_type: 'pronoun' | 'timeline' | 'character' | 'plot' | 'engagement') => {},
    isAnalyzing: false,
    progress: { current: 0, total: 0, stage: 'idle' as unknown as 'idle' },
    selectedIssueTypes: new Set([
      'pronoun',
      'timeline',
      'character',
      'plot',
      'engagement',
    ]),
  });

  return {
    __esModule: true,
    default: useAnalysis,
  };
});

// Import SUT after mocks
import IssuePanel from '../components/IssuePanel';

const openSettingsSpy = (globalThis as unknown as {
  __openSettingsSpy: ReturnType<typeof vi.fn>;
}).__openSettingsSpy;
const analyzeMovedScenesSpy = (globalThis as unknown as {
  __analyzeMovedScenesSpy: ReturnType<typeof vi.fn>;
}).__analyzeMovedScenesSpy;

// ---- Helpers ----
function seedAIStatus(partial: Partial<ReturnType<typeof useAIStatusStore.getState>['status']>) {
  const base = {
    available: false,
    workingProviders: [] as Array<'openai' | 'anthropic' | 'google'>,
    needsConfiguration: true,
    lastChecked: 0,
  };
  useAIStatusStore.setState({ status: { ...base, ...partial } });
}

describe('[typescript.component IssuePanel()](src/renderer/features/analyze/components/IssuePanel.tsx:27) AI blocking behavior', () => {
  beforeEach(() => {
    // Default to unavailable before each
    seedAIStatus({ available: false, needsConfiguration: true, lastChecked: 0 });
  });

  it('renders configuration prompt when status.available=false and buttons invoke handlers', async () => {
    const user = userEvent.setup();
 
    // Spy on store.checkStatus before render so component captures the spy
    const checkSpy = vi.spyOn(useAIStatusStore.getState(), 'checkStatus');
 
    render(<IssuePanel isOpen={true} className="" onClose={vi.fn()} />);
 
    // Prompt visible
    const statusRegion = screen.getByRole('status');
    expect(within(statusRegion).getByText(/AI Required: Continuity Analysis/i)).toBeInTheDocument();
 
    // Open Settings button
    const btnOpen = within(statusRegion).getByRole('button', { name: /open settings/i });
    await user.click(btnOpen);
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
 
    // Refresh Status button
    const btnRefresh = within(statusRegion).getByRole('button', { name: /refresh ai status/i });
    await user.click(btnRefresh);
    expect(checkSpy).toHaveBeenCalledTimes(2);
  });

  it('does not render configuration prompt when status.available=true', () => {
    seedAIStatus({ available: true, needsConfiguration: false });

    render(<IssuePanel isOpen={true} className="" onClose={vi.fn()} />);

    // The prompt heading should not be present
    expect(screen.queryByText(/AI Required: Continuity Analysis/i)).not.toBeInTheDocument();
  });

  it('pre-flight guard blocks analysis when unavailable: no downstream analyze call, no throw', async () => {
    

    // Still unavailable (seeded in beforeEach)
    // Spy checkStatus to ensure it is called on guard handling
    const checkSpy = vi.spyOn(useAIStatusStore.getState(), 'checkStatus');

    render(<IssuePanel isOpen={true} className="" onClose={vi.fn()} />);

    // Analyze button not rendered while unavailable; UI stays blocked
    expect(screen.queryByRole('button', { name: /analyz/i })).toBeNull();

    // No downstream analyze call is made
    expect(analyzeMovedScenesSpy).not.toHaveBeenCalled();

    // Only the initial effect-triggered refresh occurs
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });
});