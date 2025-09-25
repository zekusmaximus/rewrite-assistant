// Main consultation feature exports
export { default as ConsultationPanel } from './components/ConsultationPanel';
export { default as ConsultationButton } from './components/ConsultationButton';
export { default as ConsultationTrigger } from './components/ConsultationTrigger';

// Supporting components
export { default as SceneSelector } from './components/SceneSelector';
export { default as ContextViewer } from './components/ContextViewer';
export { default as ConversationHistory } from './components/ConversationHistory';
export { default as QueryInput } from './components/QueryInput';
export { default as SessionStatus } from './components/SessionStatus';

// Store
export { useConsultationStore } from './stores/consultationStore';

// Types (re-exported from shared types)
export type {
  ConsultationQuery,
  ConsultationResponse,
  ConsultationSession,
  ConsultationContext
} from '../../../shared/types';