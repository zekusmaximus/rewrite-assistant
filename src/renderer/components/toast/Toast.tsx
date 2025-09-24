import React, { useEffect, useRef, useState } from 'react';
import type { Toast as ToastModel } from '../../stores/toastStore';

type Props = {
  toast: ToastModel;
  onClose: (id: string) => void;
};

const variantStyles: Record<ToastModel['type'], { root: string; title: string; message: string; icon: string; border: string }> = {
  success: {
    root: 'bg-green-50',
    title: 'text-green-800',
    message: 'text-green-700',
    icon: 'text-green-400',
    border: 'border-green-400',
  },
  error: {
    root: 'bg-red-50',
    title: 'text-red-800',
    message: 'text-red-700',
    icon: 'text-red-400',
    border: 'border-red-400',
  },
  warning: {
    root: 'bg-amber-50',
    title: 'text-amber-800',
    message: 'text-amber-700',
    icon: 'text-amber-400',
    border: 'border-amber-400',
  },
  info: {
    root: 'bg-blue-50',
    title: 'text-blue-800',
    message: 'text-blue-700',
    icon: 'text-blue-400',
    border: 'border-blue-400',
  },
};

function Icon({ type }: { type: ToastModel['type'] }) {
  const cls = variantStyles[type].icon;
  switch (type) {
    case 'success':
      return (
        <svg className={`h-5 w-5 ${cls}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.172 7.707 8.879a1 1 0 10-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      );
    case 'error':
      return (
        <svg className={`h-5 w-5 ${cls}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      );
    case 'warning':
      return (
        <svg className={`h-5 w-5 ${cls}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.59c.75 1.334-.213 2.987-1.742 2.987H3.48c-1.53 0-2.492-1.653-1.743-2.987L8.257 3.1zM11 14a1 1 0 10-2 0 1 1 0 002 0zm-1-2a1 1 0 01-1-1V8a1 1 0 112 0v3a1 1 0 01-1 1z" clipRule="evenodd" />
        </svg>
      );
    case 'info':
    default:
      return (
        <svg className={`h-5 w-5 ${cls}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10A8 8 0 11.001 10 8 8 0 0118 10zM9 9a1 1 0 102 0V7a1 1 0 10-2 0v2zm0 2a1 1 0 000 2h1v2a1 1 0 102 0v-2a2 2 0 00-2-2H9z" clipRule="evenodd" />
        </svg>
      );
  }
}

const Toast: React.FC<Props> = ({ toast, onClose }) => {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(toast.id), 200); // match .animate-fade-out
  };

  useEffect(() => {
    const duration = toast.duration ?? 5000;
    timerRef.current = window.setTimeout(close, duration);
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const v = variantStyles[toast.type];

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'pointer-events-auto relative flex items-start gap-3 rounded-md shadow border-l-4 p-3 pr-8',
        v.root,
        v.border,
        closing ? 'animate-fade-out' : 'animate-slide-in',
      ].join(' ')}
    >
      <div className="mt-0.5">
        <Icon type={toast.type} />
      </div>

      <div className="flex-1">
        <div className={`text-sm font-medium ${v.title}`}>{toast.title}</div>
        {toast.message ? (
          <div className={`text-xs mt-0.5 ${v.message}`}>{toast.message}</div>
        ) : null}
        {toast.action ? (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="px-2 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              onClick={toast.action.onClick}
            >
              {toast.action.label}
            </button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        aria-label="Dismiss notification"
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
        onClick={close}
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  );
};

export default Toast;