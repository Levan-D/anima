import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOG_MESSAGE_MAX, LOG_STACK_MAX } from '@shared/domain';
import { reportError } from '@/lib/reportError';

const invoke = vi.fn(() => Promise.resolve({ ok: true, value: undefined }));

beforeEach(() => {
  invoke.mockClear();
  vi.stubGlobal('api', { invoke, on: vi.fn() });
});

describe('reportError', () => {
  it('sends the message and stack to main', () => {
    const error = new Error('boom');
    reportError(error);
    expect(invoke).toHaveBeenCalledWith('system.logError', { message: 'boom', stack: error.stack });
  });

  it('adds the component stack', () => {
    const error = new Error('boom');
    reportError(error, '\n    at Widget');
    expect(invoke).toHaveBeenCalledWith('system.logError', {
      message: 'boom',
      stack: `${error.stack}\n\n    at Widget`,
    });
  });

  it('reports one error once, though React hands it over twice', () => {
    const error = new Error('boom');
    reportError(error);
    reportError(error, 'from the root handler');
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('copes with things that are not errors', () => {
    reportError('just a string');
    expect(invoke).toHaveBeenCalledWith('system.logError', { message: 'just a string', stack: null });
  });

  it('stays inside the limits the contract validates', () => {
    reportError(new Error('x'.repeat(LOG_MESSAGE_MAX + 1)), 'y'.repeat(LOG_STACK_MAX + 1));
    const [, input] = invoke.mock.calls[0] as unknown as [string, { message: string; stack: string }];
    expect(input.message).toHaveLength(LOG_MESSAGE_MAX);
    expect(input.stack).toHaveLength(LOG_STACK_MAX);
  });
});
