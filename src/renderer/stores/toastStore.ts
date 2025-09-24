import { create } from 'zustand';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export type Toast = {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export type ToastStore = {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
};

const DEFAULT_DURATION = 5000;

const makeId = (): string => {
  try {
    const g: any = globalThis as any;
    const maybeUUID = g?.crypto && typeof g.crypto.randomUUID === 'function' ? g.crypto.randomUUID() : null;
    if (maybeUUID) return maybeUUID;
  } catch {
    // ignore id generation fallback
  }
  return Math.random().toString(36).slice(2);
};

const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  addToast: (t) => {
    const id = makeId();
    const toast: Toast = { id, duration: DEFAULT_DURATION, ...t };
    set((state) => ({ toasts: [toast, ...state.toasts] }));
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  success: (title, message) => get().addToast({ type: 'success', title, message }),
  warning: (title, message) => get().addToast({ type: 'warning', title, message }),
  error: (title, message) => get().addToast({ type: 'error', title, message }),
  info: (title, message) => get().addToast({ type: 'info', title, message }),
}));

export default useToastStore;

export const toast = {
  addToast: (t: Omit<Toast, 'id'>) => useToastStore.getState().addToast(t),
  removeToast: (id: string) => useToastStore.getState().removeToast(id),
  success: (title: string, message?: string) => useToastStore.getState().success(title, message),
  warning: (title: string, message?: string) => useToastStore.getState().warning(title, message),
  error: (title: string, message?: string) => useToastStore.getState().error(title, message),
  info: (title: string, message?: string) => useToastStore.getState().info(title, message),
  getState: () => useToastStore.getState(),
};