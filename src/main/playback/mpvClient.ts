/* JSON lines over mpv's connection: requests matched to replies by id, and events turned into clean shapes. */

import { StringDecoder } from 'node:string_decoder';
import * as z from 'zod';
import { err, ok, type Result } from '@shared/result';

const DEFAULT_TIMEOUT_MS = 10_000;

export const END_REASONS = ['eof', 'stop', 'quit', 'error', 'redirect', 'unknown'] as const;
export type EndReason = (typeof END_REASONS)[number];

export type MpvConnection = {
  write(line: string): void;
  onData(listener: (chunk: Buffer) => void): void;
  onClose(listener: () => void): void;
  destroy(): void;
};

export type MpvEvent =
  | { type: 'start-file'; entryId: number }
  | { type: 'end-file'; entryId: number; reason: EndReason; fileError: string | null }
  | { type: 'file-loaded' }
  | { type: 'playback-restart' }
  | { type: 'property-change'; name: string; data: unknown };

type Arg = string | number | boolean;

export type MpvClient = {
  /** Never throws. A refusal, a timeout and a closed connection all come back as an error result. */
  command(args: Arg[]): Promise<Result<unknown>>;
  /** Whether a failed command means mpv said no, rather than that it's gone. */
  isOpen(): boolean;
  close(): void;
};

type ClientOptions = {
  onEvent: (event: MpvEvent) => void;
  /** A request got no answer in time. The connection is closed by then, since nothing can be expected of it. */
  onHung: () => void;
  onMalformed: (line: string) => void;
  timeoutMs?: number;
};

// mpv leaves data out when there's none to give, and zod wants that said.
const replySchema = z.object({ request_id: z.int(), error: z.string(), data: z.unknown().optional() });
const messageSchema = z.object({ event: z.string() });
const startFileSchema = z.object({ playlist_entry_id: z.int() });
const endFileSchema = z.object({
  playlist_entry_id: z.int(),
  reason: z.enum(END_REASONS).catch('unknown'),
  file_error: z.string().optional(),
});
const propertySchema = z.object({ name: z.string(), data: z.unknown().optional() });

/** Null for what isn't needed, and for what doesn't look the way it should. */
function toEvent(message: unknown, event: string): MpvEvent | null {
  switch (event) {
    case 'start-file': {
      const parsed = startFileSchema.safeParse(message);
      return parsed.success ? { type: 'start-file', entryId: parsed.data.playlist_entry_id } : null;
    }
    case 'end-file': {
      const parsed = endFileSchema.safeParse(message);
      return parsed.success
        ? {
            type: 'end-file',
            entryId: parsed.data.playlist_entry_id,
            reason: parsed.data.reason,
            fileError: parsed.data.file_error ?? null,
          }
        : null;
    }
    case 'file-loaded':
      return { type: 'file-loaded' };
    case 'playback-restart':
      return { type: 'playback-restart' };
    case 'property-change': {
      const parsed = propertySchema.safeParse(message);
      return parsed.success
        ? { type: 'property-change', name: parsed.data.name, data: parsed.data.data ?? null }
        : null;
    }
    default:
      return null;
  }
}

type Pending = {
  finish: (result: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function createMpvClient(connection: MpvConnection, options: ClientOptions): MpvClient {
  const { onEvent, onHung, onMalformed, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const pending = new Map<number, Pending>();
  // A character can be cut in half between two chunks as easily as a line can.
  const decoder = new StringDecoder('utf8');
  let partial = '';
  let nextId = 1;
  let isClosed = false;

  function settle(id: number, result: Result<unknown>): void {
    const request = pending.get(id);
    if (request === undefined) return;
    pending.delete(id);
    clearTimeout(request.timer);
    request.finish(result);
  }

  function onLine(line: string): void {
    if (line.trim() === '') return;

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      onMalformed(line);
      return;
    }

    const isEvent = messageSchema.safeParse(message);
    if (isEvent.success) {
      const event = toEvent(message, isEvent.data.event);
      if (event !== null) onEvent(event);
      return;
    }

    const reply = replySchema.safeParse(message);
    if (!reply.success) {
      onMalformed(line);
      return;
    }
    const { request_id: id, error, data } = reply.data;
    settle(id, error === 'success' ? ok(data ?? null) : err('engine_unavailable', error));
  }

  function close(): void {
    if (isClosed) return;
    isClosed = true;
    for (const id of [...pending.keys()]) settle(id, err('engine_unavailable', 'The connection closed'));
    connection.destroy();
  }

  connection.onData((chunk) => {
    partial += decoder.write(chunk);
    const lines = partial.split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
  connection.onClose(close);

  return {
    command(args) {
      if (isClosed) return Promise.resolve(err('engine_unavailable', 'The connection closed'));
      const id = nextId++;
      return new Promise((finish) => {
        const timer = setTimeout(() => {
          settle(id, err('engine_unavailable', `No answer to ${String(args[0])}`));
          close();
          onHung();
        }, timeoutMs);
        pending.set(id, { finish, timer });
        connection.write(`${JSON.stringify({ command: args, request_id: id })}\n`);
      });
    },
    isOpen: () => !isClosed,
    close,
  };
}
