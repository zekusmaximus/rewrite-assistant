// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import RewriteStats from '../components/RewriteStats';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useRewriteStore from '../stores/rewriteStore';
import type { Manuscript, Scene, RewriteVersion } from '../../../../shared/types';

function makeManuscript(): Manuscript {
  const s1: Scene = {
    id: 's1',
    text: 'Scene 1 text',
    wordCount: 3,
    position: 0,
    originalPosition: 0,
    characters: [],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: true,
    rewriteStatus: 'approved'
  };
  const s2: Scene = {
    id: 's2',
    text: 'Scene 2 text',
    wordCount: 3,
    position: 1,
    originalPosition: 1,
    characters: [],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: false,
    rewriteStatus: 'generated'
  };
  return {
    id: 'm1',
    title: 'Stats Test',
    scenes: [s1, s2],
    originalOrder: ['s1', 's2'],
    currentOrder: ['s1', 's2']
  };
}

beforeEach(() => {
  // Seed manuscript store
  useManuscriptStore.setState({
    manuscript: makeManuscript(),
    selectedSceneId: null,
    isLoading: false,
    error: null
   
  } as any);

  // Seed rewrite store with one rewrite for s2
  const rv: RewriteVersion = {
    id: 'rv1',
    sceneId: 's2',
    timestamp: Date.now(),
    rewrittenText: 'Scene 2 rewritten',
    issuesAddressed: [],
    changesExplanation: '',
    modelUsed: 'mock',
    userEdited: false,
    appliedToManuscript: false
  };

  useRewriteStore.setState({
    sceneRewrites: new Map<string, RewriteVersion[]>([['s2', [rv]]]),
    batchProgress: undefined
   
  } as any);
});

describe('RewriteStats', () => {
  it('renders main stat cards with counts', () => {
    render(<RewriteStats />);

    // Scenes moved card shows 1/2
    expect(screen.getByText('Scenes Moved')).toBeInTheDocument();
    // Find the Scenes Moved card and check its value contains 1/2
    const scenesMovedCard = screen.getByText('Scenes Moved').closest('.p-4');
    const statValue = scenesMovedCard?.querySelector('.text-2xl');
    expect(statValue?.textContent?.replace(/\s+/g, '')).toBe('1/2');

    // Rewrites ready card shows 1/1 (rewrittenScenes/applied?) — rewrittenScenes is based on sceneRewrites map size
    expect(screen.getByText('Rewrites Ready')).toBeInTheDocument();

    // Applied card exists
    expect(screen.getByText('Applied')).toBeInTheDocument();

    // Issues fixed percentage card
    expect(screen.getByText('Issues Fixed')).toBeInTheDocument();
  });

  it('renders performance section with labels', () => {
    render(<RewriteStats />);

    // Performance section labels present
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Avg. Rewrite Time:')).toBeInTheDocument();
    expect(screen.getByText('Cache Hit Rate:')).toBeInTheDocument();
  });
});