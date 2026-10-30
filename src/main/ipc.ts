import { ipcMain, type WebFrameMain } from 'electron';
import type * as z from 'zod';
import { COMMAND_NAMES, commandChannel, eventChannel, type CommandName, type EventName } from '@shared/ipc/channels';
import { commands, type CommandResult, type Commands, type EventPayload } from '@shared/ipc/contract';
import { err, type Result } from '@shared/result';
import { log } from '@main/system/logging';
import { broadcast } from '@main/system/windows';

type Handler<N extends CommandName> = (
  input: z.output<Commands[N]['input']>,
) => CommandResult<N> | Promise<CommandResult<N>>;

/** One handler per command, so adding a command to the contract fails the build until it's bound. */
export type Handlers = { [N in CommandName]: Handler<N> };

/** What a module contributes: `export const fooHandlers = { … } satisfies HandlerGroup`. */
export type HandlerGroup = Partial<Handlers>;

type SenderCheck = (frame: WebFrameMain | null) => boolean;

// TypeScript can't correlate a name with its handler across a loop over the union.
type ErasedHandler = (input: unknown) => Result<unknown> | Promise<Result<unknown>>;

export async function dispatchCommand(
  name: CommandName,
  handler: ErasedHandler,
  input: unknown,
  frame: WebFrameMain | null,
  isAllowedSender: SenderCheck,
): Promise<Result<unknown>> {
  try {
    if (!isAllowedSender(frame)) {
      log.warn(`Rejected ${name} from origin ${frame?.origin ?? 'unknown'}`);
      return err('unexpected', "This window isn't allowed to do that.");
    }

    const schema: z.ZodType = commands[name].input;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      log.warn(`Rejected ${name}: invalid input`, parsed.error.issues);
      return err('invalid_input', `The app sent a bad request to ${name}.`);
    }

    return await handler(parsed.data);
  } catch (error) {
    log.error(`${name} threw`, error);
    return err('unexpected', 'Something went wrong. The details are in the log.');
  }
}

export function bindCommands(handlers: Handlers, isAllowedSender: SenderCheck): void {
  for (const name of COMMAND_NAMES) {
    const handler = handlers[name] as ErasedHandler;
    ipcMain.handle(commandChannel(name), (event, input: unknown) =>
      dispatchCommand(name, handler, input, event.senderFrame, isAllowedSender),
    );
  }
}

export function emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
  broadcast(eventChannel(event), payload);
}
