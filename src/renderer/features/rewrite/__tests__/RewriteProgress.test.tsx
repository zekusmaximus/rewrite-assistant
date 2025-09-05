// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import RewriteProgress from '../../rewrite/components/RewriteProgress';
import type { BatchRewriteProgress } from '../../../../services/rewrite/RewriteOrchestrator';

function makeProgress(overrides: Partial<BatchRewriteProgress> = {}): BatchRewriteProgress {
  return {
    totalScenes: 5,
    completedScenes: 2,
    phase: 'rewriting',
    message: 'Rewriting scene 3 of 5',
    currentSceneId: 's3',
    currentSceneTitle: 'Scene 3 Title',
    results: new Map(),
    errors: new Map(),
    ...overrides,
  };
}

describe('RewriteProgress component', () => {
  it('renders start prompt when no progress and not running', () => {
    const onStart = vi.fn();
    render(
      <RewriteProgress
        progress={undefined}
        isRunning={false}
        onCancel={() => {}}
        onStart={onStart}
      />
    );
    expect(screen.getByText('Batch Rewrite Process')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Start Batch Rewrite'));
    expect(onStart).toHaveBeenCalled();
  });

  it('shows progress bar and current scene when running', () => {
    const progress = makeProgress();
    render(
      <RewriteProgress
        progress={progress}
        isRunning={true}
        onCancel={() => {}}
        onStart={() => {}}
      />
    );

    // Header and message
    expect(screen.getByText('Processing Rewrites')).toBeInTheDocument();
    expect(screen.getByText(progress.message)).toBeInTheDocument();

    // Scene counters
    expect(screen.getByText(/2 \/ 5 scenes/)).toBeInTheDocument();

    // Current scene title
    expect(screen.getByText(/Currently rewriting:/)).toBeInTheDocument();
    expect(screen.getByText(progress.currentSceneTitle!)).toBeInTheDocument();

    // Progress bar width should reflect 40%
    const bar = document.querySelector('div.h-full.transition-all') as HTMLDivElement | null;
    expect(bar).toBeTruthy();
    if (bar) {
      expect(bar.style.width).toBe('40%');
    }
  });

  it('shows completion summary when complete', () => {
    const results = new Map<string, any>([['s1', {}], ['s2', {}], ['s3', {}]]);
    const errors = new Map<string, string>([['s4', 'fail']]);
    const progress = makeProgress({
      phase: 'complete',
      message: 'Done',
      completedScenes: 5,
      totalScenes: 5,
      results,
      errors,
      currentSceneId: undefined,
      currentSceneTitle: undefined
    });
    render(
      <RewriteProgress
        progress={progress}
        isRunning={false}
        onCancel={() => {}}
        onStart={() => {}}
      />
    );

    expect(screen.getByText('Batch Complete')).toBeInTheDocument();
    // Success/failed cards
    expect(screen.getByText(results.size.toString())).toBeInTheDocument();
    expect(screen.getByText(errors.size.toString())).toBeInTheDocument();
  });

  it('shows cancel button when running', () => {
    const onCancel = vi.fn();
    const progress = makeProgress();
    render(
      <RewriteProgress
        progress={progress}
        isRunning={true}
        onCancel={onCancel}
        onStart={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});