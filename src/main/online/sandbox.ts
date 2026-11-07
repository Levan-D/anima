/*
 * Runs one function of a script the person pasted in, sealed off. QuickJS in WebAssembly is the language and nothing
 * else: no files, no network, no timers. Each call gets a fresh runtime with a memory, stack and time limit, so nothing
 * carries over between calls and nothing can run away. Notes: docs/research/quickjs.md.
 */

import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import { err, errorText, ok, type Result } from '@shared/result';

const MEMORY_BYTES = 32 * 1024 * 1024;
const STACK_BYTES = 512 * 1024;
/** More than any answer the app would keep. */
const MAX_RESULT_CHARS = 2_000_000;
const MISSING = '#missing';

let loading: Promise<QuickJSWASMModule> | null = null;

function quickjs(): Promise<QuickJSWASMModule> {
  loading ??= newQuickJSWASMModuleFromVariant(releaseSync);
  return loading;
}

function failure(thrown: unknown, timeoutMs: number): string {
  if (typeof thrown === 'object' && thrown !== null) {
    const { name, message } = thrown as { name?: unknown; message?: unknown };
    if (message === 'interrupted') return `Your script took longer than ${timeoutMs} ms, so it was stopped`;
    if (typeof message === 'string')
      return `Your script failed: ${typeof name === 'string' ? `${name}: ` : ''}${message}`;
  }
  return `Your script failed: ${String(thrown)}`;
}

type Call = {
  script: string;
  /** A function the script defines at its top level. */
  name: string;
  /** Plain data, handed over as JSON. */
  args: readonly unknown[];
  timeoutMs: number;
};

/** What the function returned, as plain data, or why there's nothing. Never throws. */
export async function runScript({ script, name, args, timeoutMs }: Call): Promise<Result<unknown>> {
  let module: QuickJSWASMModule;
  try {
    module = await quickjs();
  } catch (error) {
    loading = null;
    return err('script_failed', `Scripts can't run here: ${errorText(error)}`);
  }

  const runtime = module.newRuntime();
  try {
    runtime.setMemoryLimit(MEMORY_BYTES);
    runtime.setMaxStackSize(STACK_BYTES);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));
    const context = runtime.newContext();
    try {
      // The arguments go in as a JSON string inside the code, and the answer comes back as one.
      const call = `typeof ${name} !== 'function' ? ${JSON.stringify(MISSING)} : (JSON.stringify(${name}(...JSON.parse(${JSON.stringify(JSON.stringify(args))}))) ?? 'null')`;
      const result = context.evalCode(`${script}\n;${call}`, 'script.js');
      if (result.error) {
        const thrown: unknown = context.dump(result.error);
        result.error.dispose();
        return err('script_failed', failure(thrown, timeoutMs));
      }
      const answer: unknown = context.dump(result.value);
      result.value.dispose();
      if (answer === MISSING) return err('script_failed', `Your script has no ${name} function`);
      if (typeof answer !== 'string') return err('script_failed', `${name} gave back something that isn't data`);
      if (answer.length > MAX_RESULT_CHARS) return err('script_failed', `${name} gave back far too much`);
      return ok(JSON.parse(answer) as unknown);
    } finally {
      context.dispose();
    }
  } catch (error) {
    return err('script_failed', `Your script failed: ${errorText(error)}`);
  } finally {
    try {
      runtime.dispose();
    } catch {
      // QuickJS can fail its own check freeing a runtime a script overflowed the stack of. That instance is left as it is,
      // and the next call starts a new one.
      loading = null;
    }
  }
}
