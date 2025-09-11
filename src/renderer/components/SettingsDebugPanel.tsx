import React from 'react';
import { useSettingsStore } from '../features/settings/stores/useSettingsStore';

/**
 * Temporary debug component to test settings store functionality
 * Add this to App.tsx temporarily to verify store is working
 */
const SettingsDebugPanel: React.FC = () => {
  const { isSettingsOpen, openSettings, closeSettings } = useSettingsStore();
  const fullState = useSettingsStore.getState();
  
  console.log('[SettingsDebugPanel] Rendering with isSettingsOpen:', isSettingsOpen);
  
  return (
    <div 
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        backgroundColor: 'yellow',
        border: '2px solid red',
        padding: '15px',
        zIndex: 9999,
        fontSize: '12px',
        maxWidth: '300px'
      }}
    >
      <h3>Settings Store Debug</h3>
      <p><strong>isSettingsOpen:</strong> {String(isSettingsOpen)}</p>
      <p><strong>Store exists:</strong> {String(!!useSettingsStore.getState)}</p>
      <p><strong>Instance ID:</strong> {Math.random().toString(36).substr(2, 9)}</p>
      
      <div style={{ marginTop: '10px' }}>
        <button 
          onClick={() => {
            console.log('[SettingsDebugPanel] Test open button clicked');
            openSettings();
          }}
          style={{ marginRight: '5px', padding: '5px' }}
        >
          Test Open
        </button>
        <button 
          onClick={() => {
            console.log('[SettingsDebugPanel] Test close button clicked');
            closeSettings();
          }}
          style={{ padding: '5px' }}
        >
          Test Close
        </button>
      </div>
      
      <div style={{ marginTop: '10px', fontSize: '10px' }}>
        <strong>Full State:</strong>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto' }}>
          {JSON.stringify(fullState, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default SettingsDebugPanel;