import type { CommandName, EventName } from '@shared/ipc/channels';
import type { CommandArgs, CommandResult, EventPayload } from '@shared/ipc/contract';
import type { AppError, ErrorCode, Result } from '@shared/result';

/** Lets an expected failure travel through TanStack Query, which only understands throws. */
export class AppFailure extends Error {
  readonly code: ErrorCode;

  constructor({ code, message }: AppError) {
    super(message);
    this.name = 'AppFailure';
    this.code = code;
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof AppFailure && error.code === 'not_found';
}

export function call<N extends CommandName>(name: N, ...args: CommandArgs<N>): Promise<CommandResult<N>> {
  return window.api.invoke(name, ...args);
}

/** For query functions: `queryFn: () => call('library.albums').then(unwrap)`. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new AppFailure(result.error);
  return result.value;
}

export function on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void {
  return window.api.on(event, listener);
}
