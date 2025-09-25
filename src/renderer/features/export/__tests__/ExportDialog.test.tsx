// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ExportDialog from '../components/ExportDialog';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useRewriteStore from '../../rewrite/stores/rewriteStore';
import type { Manuscript, Scene, RewriteVersion } from '../../../../shared/types';

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
      };
    };
  }
}

function makeManuscript(): Manuscript {
  const s1: Scene = {
    id: 's1',
    text: 'Scene one text',
    wordCount: 3,
    position: 0,
    originalPosition: 0,
    characters: [],
    timeMarkers: [],
    locationMarkers: [],
    hasBeenMoved: false,
    rewriteStatus: 'pending'
  };
  const s2: Scene = {
    id: 's2',
    text: 'Scene two text',
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
    title: 'Test',
    scenes: [s1, s2],
    originalOrder: ['s1', 's2'],
    currentOrder: ['s1', 's2']
  };
}

beforeEach(() => {
  // Reset stores
  useManuscriptStore.setState({
    manuscript: makeManuscript(),
    selectedSceneId: null,
    isLoading: false,
    error: null
  } as any);

  const rewriteVersion: RewriteVersion = {
    id: 'rv1',
    sceneId: 's2',
    timestamp: Date.now(),
    rewrittenText: 'Scene two new text',
    issuesAddressed: [],
    changesExplanation: '',
    modelUsed: 'mock',
    userEdited: false,
    appliedToManuscript: false
  };
  useRewriteStore.setState({
    sceneRewrites: new Map<string, RewriteVersion[]>([['s2', [rewriteVersion]]])
  } as any);

  // Mock IPC
  (window as any).electron = {
    ipcRenderer: {
      invoke: vi.fn()
    }
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExportDialog', () => {
  it('renders stats and allows option selection', () => {
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);

    // Stats visible
    expect(screen.getByText('Total Scenes:')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    // Change log detail appears when changelog selected
    const changelogRadio = screen.getByDisplayValue('changelog') as HTMLInputElement;
    fireEvent.click(changelogRadio);
    expect(screen.getByText('Change Log Detail:')).toBeInTheDocument();
  });

  it('invokes IPC on Export and closes on success', async () => {
    const onClose = vi.fn();
    const mockInvoke = vi.fn().mockResolvedValue({
      success: true,
      filePath: 'C:/tmp/export.txt'
    });
    (window as any).electron.ipcRenderer.invoke = mockInvoke;

    render(<ExportDialog isOpen={true} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Export'));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'file:export_with_rewrites',
        expect.objectContaining({
          manuscript: expect.any(Object),
          rewrites: expect.any(Object),
          options: expect.any(Object)
        })
      );
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error when export fails', async () => {
    const onClose = vi.fn();
    const mockInvoke = vi.fn().mockResolvedValue({
      success: false,
      canceled: false,
      error: 'Export failed'
    });
    (window as any).electron.ipcRenderer.invoke = mockInvoke;

    render(<ExportDialog isOpen={true} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Export'));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'file:export_with_rewrites',
        expect.objectContaining({
          manuscript: expect.any(Object),
          rewrites: expect.any(Object),
          options: expect.any(Object)
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Export failed')).toBeInTheDocument();
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});