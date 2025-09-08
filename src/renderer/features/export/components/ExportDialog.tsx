import React, { useState } from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useRewriteStore from '../../rewrite/stores/rewriteStore';
import { IPC_CHANNELS } from '../../../../shared/constants';
import type { ExportOptions } from '../../../../services/export/ManuscriptExporter';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose }) => {
  const manuscript = useManuscriptStore(state => state.manuscript);
  const sceneRewrites = useRewriteStore(state => state.sceneRewrites);
  
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: 'rewritten',
    includeMetadata: true,
    includeChangeLog: false,
    changeLogDetail: 'summary'
  });
  
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  
  if (!isOpen) return null;
  
  const handleExport = async () => {
    if (!manuscript) return;
    
    setIsExporting(true);
    setExportError(null);
    
    try {
      // Convert Map to serializable format
      const rewritesObj: Record<string, any> = {};
      sceneRewrites.forEach((value, key) => {
        rewritesObj[key] = value;
      });
      
      const result = await (window as any).electron.ipcRenderer.invoke(
        IPC_CHANNELS.EXPORT_WITH_REWRITES,
        {
          manuscript,
          rewrites: rewritesObj,
          options: exportOptions
        }
      );
      
      if (result.success) {
        onClose();
      } else if (!result.canceled) {
        setExportError(result.error || 'Export failed');
      }
    } catch (error) {
       
      console.error('[ExportDialog] Export error:', error);
      setExportError('An error occurred during export');
    } finally {
      setIsExporting(false);
    }
  };
  
  // Calculate stats
  const stats = {
    totalScenes: manuscript?.scenes.length || 0,
    rewrittenScenes:
      manuscript?.scenes.filter(s =>
        s.rewriteStatus === 'approved' || sceneRewrites.has(s.id)
      ).length || 0
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Export Manuscript
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              disabled={isExporting}
              aria-label="Close export dialog"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="px-6 py-4">
          {/* Stats */}
          <div className="mb-6 p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">
              <div className="flex justify-between mb-1">
                <span>Total Scenes:</span>
                <span className="font-medium">{stats.totalScenes}</span>
              </div>
              <div className="flex justify-between">
                <span>Rewritten Scenes:</span>
                <span className="font-medium text-green-600">{stats.rewrittenScenes}</span>
              </div>
            </div>
          </div>
          
          {/* Format Options */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Export Format
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="original"
                  checked={exportOptions.format === 'original'}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    format: e.target.value as ExportOptions['format']
                  })}
                  className="mr-2"
                />
                <span className="text-sm">Original (reordered only)</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="rewritten"
                  checked={exportOptions.format === 'rewritten'}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    format: e.target.value as ExportOptions['format']
                  })}
                  className="mr-2"
                />
                <span className="text-sm">Rewritten (with all fixes applied)</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="both"
                  checked={exportOptions.format === 'both'}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    format: e.target.value as ExportOptions['format']
                  })}
                  className="mr-2"
                />
                <span className="text-sm">Both versions (side by side)</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="changelog"
                  checked={exportOptions.format === 'changelog'}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    format: e.target.value as ExportOptions['format']
                  })}
                  className="mr-2"
                />
                <span className="text-sm">Change log only</span>
              </label>
            </div>
          </div>
          
          {/* Additional Options */}
          <div className="space-y-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={exportOptions.includeMetadata}
                onChange={(e) => setExportOptions({
                  ...exportOptions,
                  includeMetadata: e.target.checked
                })}
                className="mr-2"
              />
              <span className="text-sm">Include metadata header</span>
            </label>
            
            {exportOptions.format !== 'changelog' && (
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={exportOptions.includeChangeLog}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    includeChangeLog: e.target.checked
                  })}
                  className="mr-2"
                />
                <span className="text-sm">Append change log</span>
              </label>
            )}
            
            {(exportOptions.includeChangeLog || exportOptions.format === 'changelog') && (
              <div className="ml-6">
                <label className="text-xs text-gray-600">Change Log Detail:</label>
                <div className="mt-1 space-y-1">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="summary"
                      checked={exportOptions.changeLogDetail === 'summary'}
                      onChange={(e) => setExportOptions({
                        ...exportOptions,
                        changeLogDetail: e.target.value as ExportOptions['changeLogDetail']
                      })}
                      className="mr-2"
                    />
                    <span className="text-xs">Summary</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="detailed"
                      checked={exportOptions.changeLogDetail === 'detailed'}
                      onChange={(e) => setExportOptions({
                        ...exportOptions,
                        changeLogDetail: e.target.value as ExportOptions['changeLogDetail']
                      })}
                      className="mr-2"
                    />
                    <span className="text-xs">Detailed</span>
                  </label>
                </div>
              </div>
            )}
          </div>
          
          {/* Error Message */}
          {exportError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-600">{exportError}</p>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportDialog;