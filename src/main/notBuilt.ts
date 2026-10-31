import { err } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';

const notBuilt = () => err('unexpected', "This part isn't built yet");

export const statsNotBuilt = {
  'stats.summary': notBuilt,
} satisfies HandlerGroup;
