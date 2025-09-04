import React, { useMemo } from 'react';
import type { DiffSegment } from '../../../../shared/types';

interface DiffViewerProps {
  originalText: string;
  rewrittenText: string;
  diffSegments?: DiffSegment[];
  viewMode?: 'side-by-side' | 'inline';
  className?: string;
}

const DiffViewer: React.FC<DiffViewerProps> = ({
  originalText,
  rewrittenText,
  diffSegments = [],
  viewMode = 'side-by-side',
  className = ''
}) => {
  // Calculate line-by-line diff for side-by-side view
  const lineDiff = useMemo(() => {
    const originalLines = originalText.split('\n');
    const rewrittenLines = rewrittenText.split('\n');
    
    // Simple line matching - enhance with proper diff algorithm if needed
    const maxLines = Math.max(originalLines.length, rewrittenLines.length);
    const lines: Array<{ original?: string; rewritten?: string; changed: boolean }> = [];
    
    for (let i = 0; i < maxLines; i++) {
      const original = originalLines[i];
      const rewritten = rewrittenLines[i];
      lines.push({
        original,
        rewritten,
        changed: original !== rewritten
      });
    }
    
    return lines;
  }, [originalText, rewrittenText]);
  
  // Render segment with appropriate styling
  const renderSegment = (segment: DiffSegment, index: number) => {
    const baseClasses = 'px-1 rounded';
    const typeClasses = {
      added: 'bg-green-100 text-green-900',
      removed: 'bg-red-100 text-red-900 line-through',
      unchanged: ''
    };
    
    return (
      <span
        key={index}
        className={`${baseClasses} ${typeClasses[segment.type]}`}
        title={segment.reason}
      >
        {segment.text}
      </span>
    );
  };
  
  if (viewMode === 'side-by-side') {
    return (
      <div className={`grid grid-cols-2 gap-4 ${className}`}>
        {/* Original Text */}
        <div className="border border-gray-200 rounded-lg bg-white">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700">Original</h3>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto">
            <div className="prose prose-sm max-w-none">
              {lineDiff.map((line, i) => (
                <div
                  key={i}
                  className={`py-1 ${line.changed ? 'bg-red-50' : ''}`}
                >
                  {line.original || <span className="text-gray-400">(removed)</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Rewritten Text */}
        <div className="border border-gray-200 rounded-lg bg-white">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700">Rewritten</h3>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto">
            <div className="prose prose-sm max-w-none">
              {lineDiff.map((line, i) => (
                <div
                  key={i}
                  className={`py-1 ${line.changed ? 'bg-green-50' : ''}`}
                >
                  {line.rewritten || <span className="text-gray-400">(added)</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Inline diff view
  return (
    <div className={`border border-gray-200 rounded-lg bg-white ${className}`}>
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">Changes</h3>
      </div>
      <div className="p-4 max-h-96 overflow-y-auto">
        <div className="prose prose-sm max-w-none">
          {diffSegments.length > 0 ? (
            diffSegments.map(renderSegment)
          ) : (
            <div className="text-gray-500 italic">
              Generating diff view...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;