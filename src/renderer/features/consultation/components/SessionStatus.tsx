import React from 'react';
import { useConsultationStore } from '../stores/consultationStore';

export interface SessionStatusProps {
  className?: string;
}

const SessionStatus: React.FC<SessionStatusProps> = ({ className = '' }) => {
  const {
    isSessionActive,
    sessionStartTime,
    conversationHistory,
    isLoading,
    contextSummary
  } = useConsultationStore();

  const getSessionDuration = () => {
    if (!sessionStartTime) return null;
    const duration = Date.now() - sessionStartTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  };

  const getStatusInfo = () => {
    if (!isSessionActive) {
      return {
        label: 'No active session',
        color: 'gray',
        icon: (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 012 0v4a1 1 0 11-2 0V7zM8 11a1 1 0 112 0 1 1 0 01-2 0z" clipRule="evenodd" />
          </svg>
        )
      };
    }

    if (isLoading) {
      return {
        label: 'Processing...',
        color: 'blue',
        icon: (
          <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )
      };
    }

    return {
      label: 'Active session',
      color: 'green',
      icon: (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      )
    };
  };

  const statusInfo = getStatusInfo();
  const duration = getSessionDuration();

  const colorClasses = {
    gray: 'text-gray-600 bg-gray-100',
    blue: 'text-blue-600 bg-blue-100',
    green: 'text-green-600 bg-green-100',
  };

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      {/* Status Indicator */}
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${colorClasses[statusInfo.color as keyof typeof colorClasses]}`}>
        {statusInfo.icon}
        <span className="font-medium">{statusInfo.label}</span>
      </div>

      {/* Session Details */}
      {isSessionActive && (
        <div className="flex items-center gap-3 text-gray-600">
          {duration && (
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{duration}</span>
            </div>
          )}

          {conversationHistory.length > 0 && (
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.13 8.13 0 01-2.939-.515l-3.677 1.158.892-2.677C6.295 16.982 5 14.611 5 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
              </svg>
              <span>{conversationHistory.length} exchange{conversationHistory.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {contextSummary && (
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>{contextSummary.sceneCount} scene{contextSummary.sceneCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SessionStatus;