import type { Result } from '@shared/result';
import { create } from 'zustand';
import type { Notice } from '@shared/domain';

export type ToastLevel = Notice['level'];

export type ToastAction = {
  label: string;
  run: () => void;
};

/** 0 to 1, or how far along can't be told. */
export type ToastProgress = number | 'indeterminate';

export type Toast = {
  id: number;
  message: string;
  level: ToastLevel;
  action: ToastAction | null;
  /** Null for a plain toast. One with progress stays up until it's updated without any, or dismissed. */
  progress: ToastProgress | null;
  open: boolean;
};

type NewToast = {
  /** What an earlier `showToast` returned, to change that toast rather than show another. */
  id?: number;
  message: string;
  level?: ToastLevel;
  action?: ToastAction;
  progress?: ToastProgress | null;
};

export const TOAST_DURATION_MS = 6_000;
const MAX_VISIBLE = 3;

const useToastStore = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));

let nextId = 1;

/** The oldest goes first, except that something still running keeps its place while there's anything else to drop. */
function withinLimit(toasts: Toast[]): Toast[] {
  if (toasts.length <= MAX_VISIBLE) return toasts;
  const oldestPlain = toasts.findIndex(({ progress }) => progress === null);
  const dropped = Math.max(oldestPlain, 0);
  return withinLimit(toasts.filter((_, index) => index !== dropped));
}

/** Returns the toast's id, to update it with. */
export function showToast({ id, message, level = 'info', action, progress = null }: NewToast): number {
  const { toasts } = useToastStore.getState();
  const toastId = id ?? nextId++;
  const isOpen = toasts.some((existing) => existing.id === toastId && existing.open);
  // Dismissed while running, it stays away, and only comes back when there's an outcome to say.
  if (id !== undefined && !isOpen && progress !== null) return toastId;

  const toast: Toast = { id: toastId, message, level, action: action ?? null, progress, open: true };
  if (isOpen) {
    useToastStore.setState({ toasts: toasts.map((existing) => (existing.id === toastId ? toast : existing)) });
    return toastId;
  }

  // Saying the same thing again starts it over, rather than stacking up copies of it.
  const others = toasts.filter(
    (existing) => existing.open && (existing.message !== message || existing.progress !== null),
  );
  useToastStore.setState({ toasts: withinLimit([...others, toast]) });
  return toastId;
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

/** For a command whose only answer to a refusal is to say so. */
export function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

/** For a promise that rejected, which should never happen, but says so if it does. */
export function toastFailure(error: unknown): void {
  showToast({ message: error instanceof Error ? error.message : 'That did not work', level: 'error' });
}
