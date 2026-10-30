import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { COMMAND_NAMES, EVENT_NAMES, commandChannel, eventChannel } from '@shared/ipc/channels';
import type { CommandName, EventName } from '@shared/ipc/channels';
import type { Api, CommandResult, EventPayload } from '@shared/ipc/contract';

const commandNames = new Set<string>(COMMAND_NAMES);
const eventNames = new Set<string>(EVENT_NAMES);

const api: Api = {
  invoke<N extends CommandName>(name: N, ...args: unknown[]) {
    if (!commandNames.has(name)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'invalid_input', message: `Unknown command: ${name}` },
      } satisfies CommandResult<N>);
    }
    return ipcRenderer.invoke(commandChannel(name), ...args) as Promise<CommandResult<N>>;
  },

  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void) {
    if (!eventNames.has(event)) throw new Error(`Unknown event: ${event}`);
    const channel = eventChannel(event);
    const forward = (_event: IpcRendererEvent, payload: EventPayload<E>) => listener(payload);
    ipcRenderer.on(channel, forward);
    return () => {
      ipcRenderer.removeListener(channel, forward);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
