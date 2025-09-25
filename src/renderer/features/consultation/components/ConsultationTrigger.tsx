import React from 'react';
import { useConsultationStore } from '../stores/consultationStore';
import type { Scene } from '../../../../shared/types';

export interface ConsultationTriggerProps {
  scene: Scene;
  className?: string;
  variant?: 'button' | 'icon' | 'menu-item';
}

const ConsultationTrigger: React.FC<ConsultationTriggerProps> = ({
  scene,
  className = '',
  variant = 'button'
}) => {
  const { openPanel, selectScenes } = useConsultationStore();

  const handleConsultScene = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Open panel and pre-select this scene
    selectScenes([scene.id]);
    openPanel();
  };

  const renderButton = () => (
    <button
      onClick={handleConsultScene}
      className={`
        inline-flex items-center gap-1.5 px-2 py-1 text-xs
        text-purple-600 hover:text-purple-700 hover:bg-purple-50
        border border-purple-200 rounded transition-colors
        ${className}
      `}
      title={`Ask AI about scene: ${scene.id}`}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Ask AI</span>
    </button>
  );

  const renderIcon = () => (
    <button
      onClick={handleConsultScene}
      className={`
        p-1.5 text-purple-600 hover:text-purple-700 hover:bg-purple-50
        rounded transition-colors
        ${className}
      `}
      title={`Ask AI about scene: ${scene.id}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
  );

  const renderMenuItem = () => (
    <button
      onClick={handleConsultScene}
      className={`
        w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700
        hover:bg-purple-50 hover:text-purple-700 transition-colors
        ${className}
      `}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Ask AI about this scene</span>
    </button>
  );

  switch (variant) {
    case 'icon':
      return renderIcon();
    case 'menu-item':
      return renderMenuItem();
    default:
      return renderButton();
  }
};

export default ConsultationTrigger;