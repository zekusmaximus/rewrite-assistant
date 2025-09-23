// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock BEFORE importing SUT
vi.mock('../../features/settings/stores/useSettingsStore', () => {
  const __openSettingsSpy = vi.fn();
  // expose spy on globalThis to avoid TS type mismatch on module augmentation
  (globalThis as unknown as { __openSettingsSpy: ReturnType<typeof vi.fn> }).__openSettingsSpy =
    __openSettingsSpy;

  // zustand-like selector signature for the mock
  const useSettingsStore = ((selector?: (s: { openSettings: () => void }) => unknown) => {
    const state = { openSettings: __openSettingsSpy };
    return typeof selector === 'function' ? selector(state) : state;
  }) as unknown as typeof import('../../features/settings/stores/useSettingsStore').useSettingsStore;

  return {
    __esModule: true,
    useSettingsStore,
  };
});

// Now import SUT and deps
import AIStatusIndicator from '../AIStatusIndicator';
import { useAIStatusStore } from '../../stores/aiStatusStore';

const openSettingsSpy = (globalThis as unknown as {
  __openSettingsSpy: ReturnType<typeof vi.fn>;
}).__openSettingsSpy;

function seedAIStatus(partial: Partial<ReturnType<typeof useAIStatusStore.getState>['status']>) {
  const base = {
    available: false,
    workingProviders: [] as Array<'anthropic' | 'openai' | 'google'>,
    needsConfiguration: true,
    lastChecked: 0,
    isChecking: false,
  };
  useAIStatusStore.setState({ status: { ...base, ...partial } });
}

describe('[typescript.function AIStatusIndicator()](src/renderer/components/AIStatusIndicator.tsx:19)', () => {
  beforeEach(() => {
    // reset store before each
    seedAIStatus({ available: false, needsConfiguration: true, lastChecked: 0 });
    openSettingsSpy.mockReset();
  });

  it('available=true -> shows green dot and "AI Services Active"; no Configure button', () => {
    seedAIStatus({ available: true, needsConfiguration: false });

    render(<AIStatusIndicator />);

    // Accessible wrapper
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();

    // Text content robust via regex
    expect(within(region).getByText(/AI Services Active/i)).toBeInTheDocument();

    // The dot is aria-hidden => select and assert class
    const dotHidden = within(region).getByText((_, el) => el?.getAttribute('aria-hidden') === 'true') as HTMLElement;
    expect(dotHidden.className).toMatch(/bg-green-500/);

    // No configure button
    expect(within(region).queryByRole('button', { name: /configure/i })).toBeNull();
  });

  it('available=false -> shows amber dot and "AI Services Required"; Configure button calls openSettings', async () => {
    const user = userEvent.setup();
    seedAIStatus({ available: false, needsConfiguration: true });

    render(<AIStatusIndicator />);

    const region = screen.getByRole('status');
    expect(within(region).getByText(/AI Services Required/i)).toBeInTheDocument();

    // Dot is amber
    const dotHidden = within(region).getByText((_, el) => el?.getAttribute('aria-hidden') === 'true') as HTMLElement;
    expect(dotHidden.className).toMatch(/bg-amber-500/);

    // Button with aria-label
    const configureBtn = within(region).getByRole('button', { name: /configure ai services/i });
    await user.click(configureBtn);
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  it('accessibility basics: wrapper role=status and button aria-label present when unavailable', () => {
    seedAIStatus({ available: false });

    render(<AIStatusIndicator />);

    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();

    const btn = within(region).getByRole('button', { name: /configure ai services/i });
    expect(btn).toBeInTheDocument();
  });
});