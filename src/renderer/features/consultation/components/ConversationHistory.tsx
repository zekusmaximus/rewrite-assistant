import React, { useEffect, useRef } from 'react';
import type { ConversationExchange } from '../stores/consultationStore';
import type { ContinuityIssue } from '../../../../shared/types';

export interface ConversationHistoryProps {
  history: ConversationExchange[];
  isLoading?: boolean;
  className?: string;
}

const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  history,
  isLoading = false,
  className = ''
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history.length, isLoading]);

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatConfidence = (confidence: number) => {
    return Math.round(confidence * 100);
  };

  if (history.length === 0 && !isLoading) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <svg className="w-8 h-8 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.13 8.13 0 01-2.939-.515l-3.677 1.158.892-2.677C6.295 16.982 5 14.611 5 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
        </svg>
        <p className="text-sm">No conversation yet</p>
        <p className="text-xs text-gray-400 mt-1">Ask a question to start your consultation</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        ref={scrollRef}
        className="max-h-96 overflow-y-auto space-y-4 p-3 bg-gray-50 rounded-lg border border-gray-200"
      >
        {history.map((exchange, index) => (
          <div key={`${exchange.timestamp}-${index}`} className="space-y-3">
            {/* User Question */}
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-purple-600 text-white rounded-lg px-3 py-2">
                <p className="text-sm">{exchange.query.question}</p>
                <p className="text-xs text-purple-200 mt-1">
                  {formatTimestamp(exchange.timestamp)}
                </p>
              </div>
            </div>

            {/* AI Response */}
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-white border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-4 rounded bg-blue-100 flex items-center justify-center">
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <span className="text-xs text-gray-600">
                    {exchange.response.modelUsed}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatConfidence(exchange.response.confidence)}% confidence
                  </span>
                </div>

                <div className="prose prose-sm max-w-none">
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">
                    {exchange.response.answer}
                  </p>
                </div>

                {/* Referenced Issues */}
                {exchange.response.referencedIssues.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-600 mb-1">Referenced issues:</p>
                    <div className="space-y-1">
                      {exchange.response.referencedIssues.slice(0, 3).map((issue: ContinuityIssue, issueIndex: number) => (
                        <div
                          key={`${issue.type}-${issueIndex}`}
                          className="text-xs text-gray-700 bg-gray-100 rounded px-2 py-1"
                        >
                          <span className="font-medium capitalize">{issue.type}</span>
                          <span className="text-gray-500"> • </span>
                          <span>{issue.description.substring(0, 60)}{issue.description.length > 60 ? '...' : ''}</span>
                        </div>
                      ))}
                      {exchange.response.referencedIssues.length > 3 && (
                        <p className="text-xs text-gray-500">
                          +{exchange.response.referencedIssues.length - 3} more issues
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  {formatTimestamp(exchange.response.timestamp)}
                </p>
              </div>
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-white border border-gray-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-blue-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-blue-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <span className="text-xs text-gray-600">AI is thinking...</span>
              </div>
              <div className="mt-2 flex gap-1">
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationHistory;