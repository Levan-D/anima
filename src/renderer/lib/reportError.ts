import { LOG_MESSAGE_MAX, LOG_STACK_MAX } from '@shared/domain';
import { call } from '@/lib/api';

// An error caught by a boundary reaches both the boundary and the root's onCaughtError.
const reported = new WeakSet<object>();

export function reportError(error: unknown, componentStack: string | null = null): void {
  if (typeof error === 'object' && error !== null) {
    if (reported.has(error)) return;
    reported.add(error);
  }

  const message = error instanceof Error ? error.message : String(error);
  const stack = [error instanceof Error ? error.stack : null, componentStack].filter(Boolean).join('\n');

  void call('system.logError', {
    message: message.slice(0, LOG_MESSAGE_MAX),
    stack: stack === '' ? null : stack.slice(0, LOG_STACK_MAX),
  });
}
