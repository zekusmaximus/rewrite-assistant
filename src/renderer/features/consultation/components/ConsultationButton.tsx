import React from 'react';
import { useConsultationStore } from '../stores/consultationStore';
import { useManuscriptStore } from '../../../stores/manuscriptStore';

export interface ConsultationButtonProps {
  className?: string;
  variant?: 'primary' | 'secondary' | 'toolbar';
  size?: 'sm' | 'md' | 'lg';
}

const ConsultationButton: React.FC<ConsultationButtonProps> = ({
  className = '',
  variant = 'primary',
  size = 'md'
}) => {
  const manuscript = useManuscriptStore((s) => s.manuscript);
  const { isPanelOpen, openPanel, closePanel } = useConsultationStore();

  const handleToggle = () => {
    if (isPanelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  };

  const sizeClasses = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-2 text-base'
  };

  const variantClasses = {
    primary: `
      bg-purple-600 text-white hover:bg-purple-700
      focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2
    `,
    secondary: `
      bg-white text-purple-600 border border-purple-300 hover:bg-purple-50
      focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2
    `,
    toolbar: `
      bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300
      focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
    `
  };

  const iconSize = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  const isDisabled = !manuscript || !manuscript.scenes || manuscript.scenes.length === 0;

  return (
    <button
      onClick={handleToggle}
      disabled={isDisabled}
      className={`
        inline-flex items-center gap-2 rounded-lg transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${className}
      `}
      title={
        isDisabled
          ? 'Load a manuscript to use Scene Consultation'
          : isPanelOpen
          ? 'Close Scene Consultation'
          : 'Open Scene Consultation'
      }
    >
      <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {isPanelOpen ? (
          // Close icon when panel is open
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        ) : (
          // Question/consultation icon when panel is closed
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        )}
      </svg>

      {variant !== 'toolbar' && (
        <span>
          {isPanelOpen ? 'Close' : 'Scene'} Consultation
        </span>
      )}

      {/* Badge for active session */}
      {isPanelOpen && (
        <span className="inline-flex items-center justify-center w-2 h-2 bg-green-400 rounded-full">
          <span className="sr-only">Active session</span>
        </span>
      )}
    </button>
  );
};

export default ConsultationButton;