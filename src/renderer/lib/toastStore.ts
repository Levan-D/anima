import { create } from 'zustand';
import type { Notice } from '@shared/domain';

export type ToastLevel = Notice['level'];

export type ToastAction = {
  label: string;
  run: () => void;
};

export type Toast = {
  id: number;
  message: string;
  level: ToastLevel;
  action: ToastAction | null;
  open: boolean;
};

type NewToast = {
  message: string;
  level?: ToastLevel;
  action?: ToastAction;
};

const MAX_VISIBLE = 3;

const useToastStore = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));

let nextId = 1;

export function showToast({ message, level = 'info', action }: NewToast): void {
  const toast: Toast = { id: nextId++, message, level, action: action ?? null, open: true };
  useToastStore.setState(({ toasts }) => ({
    toasts: [...toasts.filter((existing) => existing.open), toast].slice(-MAX_VISIBLE),
  }));
}

/** Keeps the toast mounted but closed, so it can animate out. The next toast sweeps it away. */
export function dismissToast(id: number): void {
  useToastStore.setState(({ toasts }) => ({
    toasts: toasts.map((toast) => (toast.id === id ? { ...toast, open: false } : toast)),
  }));
}

export function useToasts(): Toast[] {
  return useToastStore((state) => state.toasts);
}
