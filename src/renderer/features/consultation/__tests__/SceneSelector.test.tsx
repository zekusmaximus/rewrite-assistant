// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SceneSelector from '../components/SceneSelector';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import type { Manuscript } from '../../../../shared/types';

// Don't mock the manuscript store, we'll use the real one

const mockManuscript: Manuscript = {
  id: 'test-manuscript',
  title: 'Test Manuscript',
  scenes: [
    {
      id: 'scene1',
      text: 'First scene with Alice talking about her day',
      wordCount: 8,
      position: 0,
      originalPosition: 0,
      characters: ['Alice'],
      timeMarkers: ['Morning'],
      locationMarkers: ['Kitchen'],
      hasBeenMoved: true,
      rewriteStatus: 'pending',
      continuityAnalysis: {
        issues: [
          {
            type: 'pronoun',
            severity: 'should-fix',
            description: 'Unclear pronoun reference',
            textSpan: [0, 10],
            suggestedFix: 'Use explicit name'
          }
        ],
        timestamp: Date.now(),
        modelUsed: 'test-model',
        confidence: 0.8,
        readerContext: {
          knownCharacters: new Set(['Alice']),
          establishedTimeline: [],
          revealedPlotPoints: [],
          establishedSettings: []
        }
      }
    },
    {
      id: 'scene2',
      text: 'Second scene content here',
      wordCount: 4,
      position: 1,
      originalPosition: 1,
      characters: ['Bob', 'Charlie'],
      timeMarkers: [],
      locationMarkers: ['Garden'],
      hasBeenMoved: false,
      rewriteStatus: 'pending'
    },
    {
      id: 'scene3',
      text: 'Third scene with multiple issues for testing',
      wordCount: 8,
      position: 2,
      originalPosition: 2,
      characters: ['Alice', 'Bob'],
      timeMarkers: ['Evening'],
      locationMarkers: ['Living Room'],
      hasBeenMoved: true,
      rewriteStatus: 'approved',
      continuityAnalysis: {
        issues: [
          {
            type: 'timeline',
            severity: 'must-fix',
            description: 'Timeline inconsistency',
            textSpan: [0, 20]
          },
          {
            type: 'character',
            severity: 'should-fix',
            description: 'Character behavior inconsistency',
            textSpan: [20, 40]
          }
        ],
        timestamp: Date.now(),
        modelUsed: 'test-model',
        confidence: 0.9,
        readerContext: {
          knownCharacters: new Set(['Alice', 'Bob']),
          establishedTimeline: [],
          revealedPlotPoints: [],
          establishedSettings: []
        }
      }
    }
  ],
  originalOrder: ['scene1', 'scene2', 'scene3'],
  currentOrder: ['scene1', 'scene2', 'scene3']
};

describe('SceneSelector', () => {
  const mockOnSelectionChange = vi.fn();

  beforeEach(() => {
    useManuscriptStore.setState({
      manuscript: mockManuscript,
      selectedSceneId: null,
      isLoading: false,
      error: null
    });
    mockOnSelectionChange.mockClear();
  });

  it('should render scene list when manuscript is loaded', () => {
    render(
      <SceneSelector
        selectedSceneIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    expect(screen.getByText('scene1')).toBeInTheDocument();
    expect(screen.getByText('scene2')).toBeInTheDocument();
    expect(screen.getByText('scene3')).toBeInTheDocument();
  });

  it('should show empty state when no manuscript', () => {
    useManuscriptStore.setState({ manuscript: null });

    render(
      <SceneSelector
        selectedSceneIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    expect(screen.getByText('No manuscript loaded')).toBeInTheDocument();
  });

  it('should display scene information correctly', () => {
    render(
      <SceneSelector
        selectedSceneIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    // Check scene1 details
    expect(screen.getByText('Position 1')).toBeInTheDocument();
    expect(screen.getAllByText('Moved')).toHaveLength(2); // scene1 and scene3 are both moved
    expect(screen.getByText('1 issue')).toBeInTheDocument();
    expect(screen.getAllByText('Alice')).toHaveLength(2); // Alice appears in scene1 and scene3

    // Check scene2 details
    expect(screen.getByText('Position 2')).toBeInTheDocument();
    expect(screen.getAllByText('Bob')).toHaveLength(2); // Bob appears in scene2 and scene3
    expect(screen.getByText('Charlie')).toBeInTheDocument(); // Charlie only appears in scene2

    // Check scene3 details
    expect(screen.getByText('2 issues')).toBeInTheDocument();
  });

  it('should handle individual scene selection', () => {
    render(
      <SceneSelector
        selectedSceneIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    const scene1Checkbox = screen.getByDisplayValue('scene1');
    fireEvent.click(scene1Checkbox);

    expect(mockOnSelectionChange).toHaveBeenCalledWith(['scene1']);
  });

  it('should handle scene deselection', () => {
    render(
      <SceneSelector
        selectedSceneIds={['scene1', 'scene2']}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    const scene1Checkbox = screen.getByDisplayValue('scene1');
    fireEvent.click(scene1Checkbox);

    expect(mockOnSelectionChange).toHaveBeenCalledWith(['scene2']);
  });

  it('should show correct selection summary', () => {
    render(
      <SceneSelector
        selectedSceneIds={['scene1', 'scene3']}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    expect(screen.getByText('2 of 3 scenes selected')).toBeInTheDocument();
  });

  it('should show no selection message when nothing selected', () => {
    render(
      <SceneSelector
        selectedSceneIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    expect(screen.getByText('No scenes selected')).toBeInTheDocument();
  });

  describe('batch selection buttons', () => {
    it('should select all scenes', () => {
      render(
        <SceneSelector
          selectedSceneIds={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      const allButton = screen.getByText('All (3)');
      fireEvent.click(allButton);

      expect(mockOnSelectionChange).toHaveBeenCalledWith(['scene1', 'scene2', 'scene3']);
    });

    it('should clear all selections', () => {
      render(
        <SceneSelector
          selectedSceneIds={['scene1', 'scene2']}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      const noneButton = screen.getByText('None');
      fireEvent.click(noneButton);

      expect(mockOnSelectionChange).toHaveBeenCalledWith([]);
    });

    it('should select only moved scenes', () => {
      render(
        <SceneSelector
          selectedSceneIds={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      const movedButton = screen.getByText('Moved (2)');
      fireEvent.click(movedButton);

      expect(mockOnSelectionChange).toHaveBeenCalledWith(['scene1', 'scene3']);
    });

    it('should select only scenes with issues', () => {
      render(
        <SceneSelector
          selectedSceneIds={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      const issuesButton = screen.getByText('With Issues (2)');
      fireEvent.click(issuesButton);

      expect(mockOnSelectionChange).toHaveBeenCalledWith(['scene1', 'scene3']);
    });

    it('should not show moved button when no moved scenes', () => {
      const manuscriptWithoutMoved = {
        ...mockManuscript,
        scenes: mockManuscript.scenes.map(s => ({ ...s, hasBeenMoved: false }))
      };

      useManuscriptStore.setState({
        manuscript: manuscriptWithoutMoved
      });

      render(
        <SceneSelector
          selectedSceneIds={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.queryByText(/Moved \(/)).not.toBeInTheDocument();
    });

    it('should not show issues button when no scenes with issues', () => {
      const manuscriptWithoutIssues = {
        ...mockManuscript,
        scenes: mockManuscript.scenes.map(s => ({ ...s, continuityAnalysis: undefined }))
      };

      useManuscriptStore.setState({
        manuscript: manuscriptWithoutIssues
      });

      render(
        <SceneSelector
          selectedSceneIds={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.queryByText(/With Issues \(/)).not.toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('should disable all controls when disabled prop is true', () => {
      render(
        <SceneSelector
          selectedSceneIds={[]}
          onSelectionChange={mockOnSelectionChange}
          disabled={true}
        />
      );

      const allButton = screen.getByText('All (3)');
      const noneButton = screen.getByText('None');
      const checkboxes = screen.getAllByRole('checkbox');

      expect(allButton).toBeDisabled();
      expect(noneButton).toBeDisabled();
      checkboxes.forEach(checkbox => {
        expect(checkbox).toBeDisabled();
      });
    });

    it('should not trigger selection changes when disabled', () => {
      render(
        <SceneSelector
          selectedSceneIds={[]}
          onSelectionChange={mockOnSelectionChange}
          disabled={true}
        />
      );

      const allButton = screen.getByText('All (3)');
      fireEvent.click(allButton);

      expect(mockOnSelectionChange).not.toHaveBeenCalled();
    });
  });

  it('should display scene text preview', () => {
    render(
      <SceneSelector
        selectedSceneIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    expect(screen.getByText(/First scene with Alice talking about her day/)).toBeInTheDocument();
    expect(screen.getByText(/Second scene content here/)).toBeInTheDocument();
  });

  it('should truncate long scene text with ellipsis', () => {
    const longTextManuscript = {
      ...mockManuscript,
      scenes: [{
        ...mockManuscript.scenes[0],
        text: 'This is a very long scene text that should be truncated because it exceeds the display limit of 120 characters and we need to show ellipsis'
      }]
    };

    useManuscriptStore.setState({
      manuscript: longTextManuscript
    });

    render(
      <SceneSelector
        selectedSceneIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    expect(screen.getByText(/This is a very long scene text that should be truncated because it exceeds the display limit of 120 charact.../)).toBeInTheDocument();
  });
});