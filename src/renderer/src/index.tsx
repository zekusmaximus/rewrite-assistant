import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { AIServiceErrorBoundary } from '../components/error-boundaries';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);

// Ensure the toast container mounts at root level properly even when children are remounted.
// The boundary will remount subtree on recovery via a key bump.
root.render(
  <AIServiceErrorBoundary feature="root">
    <App />
  </AIServiceErrorBoundary>
);

