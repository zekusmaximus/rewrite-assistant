import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';

export interface QueryInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (query: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const QueryInput: React.FC<QueryInputProps> = ({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = 'Ask me about your scenes...',
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmedValue = value.trim();
    if (!trimmedValue || disabled) return;

    await onSend(trimmedValue);
  }, [value, onSend, disabled]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift+Enter allows new line
        return;
      } else {
        // Enter sends the message
        e.preventDefault();
        void handleSend();
      }
    }
  }, [handleSend]);

  const handleFocus = useCallback(() => {
    setIsExpanded(true);
  }, []);

  const handleBlur = useCallback(() => {
    if (!value.trim()) {
      setIsExpanded(false);
    }
  }, [value]);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  React.useEffect(() => {
    adjustTextareaHeight();
  }, [value, adjustTextareaHeight]);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className={`border border-gray-200 rounded-lg bg-white ${className}`}>
      {/* Suggestions (shown when input is focused but empty) */}
      {isExpanded && !value.trim() && (
        <div className="p-3 border-b border-gray-100">
          <p className="text-xs text-gray-600 mb-2">Try asking about:</p>
          <div className="flex flex-wrap gap-2">
            {[
              'How does this reordering affect character development?',
              'What continuity issues should I be aware of?',
              'Does this scene placement work for reader understanding?',
              'What timeline problems might this create?',
              'How does this impact the story flow?'
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => onChange(suggestion)}
                disabled={disabled}
                className="text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50 px-2 py-1 rounded border border-purple-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2 p-3">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none border-0 p-0 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-0 disabled:opacity-50"
            style={{ minHeight: '20px', maxHeight: '120px' }}
            aria-label="Consultation query input"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`
            flex-shrink-0 p-2 rounded-lg transition-colors
            ${canSend
              ? 'bg-purple-600 text-white hover:bg-purple-700'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }
          `}
          aria-label="Send query"
        >
          {disabled ? (
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>

      {/* Help Text */}
      {isExpanded && (
        <div className="px-3 pb-2 text-xs text-gray-500">
          Press Enter to send, Shift+Enter for new line
        </div>
      )}
    </div>
  );
};

export default QueryInput;