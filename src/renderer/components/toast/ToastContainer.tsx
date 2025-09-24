import React from 'react';
import Toast from './Toast';
import useToastStore from '../../stores/toastStore';

const ToastContainer: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div className="fixed top-4 right-4 z-[1000] flex flex-col gap-3 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onClose={removeToast} />
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;