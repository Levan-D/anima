import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import { dispatchCommand } from '@main/ipc';
import { log } from '@main/system/logging';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('@main/system/windows', () => ({ broadcast: vi.fn() }));
vi.mock('@main/system/logging', () => ({ log: { warn: vi.fn(), error: vi.fn() } }));

const allow = () => true;
const refuse = () => false;
const frame = null;

describe('dispatchCommand', () => {
  beforeEach(() => {
    vi.mocked(log.error).mockClear();
  });

  it('hands valid input to the handler and returns its Result', async () => {
    const handler = vi.fn(() => ok('done'));
    const result = await dispatchCommand('library.album', handler, { albumId: 7 }, frame, allow);
    expect(handler).toHaveBeenCalledWith({ albumId: 7 });
    expect(result).toEqual({ ok: true, value: 'done' });
  });

  it('awaits async handlers', async () => {
    const result = await dispatchCommand('settings.get', () => Promise.resolve(ok(1)), undefined, frame, allow);
    expect(result).toEqual({ ok: true, value: 1 });
  });

  it('refuses a sender before looking at anything else', async () => {
    const handler = vi.fn(() => ok());
    const result = await dispatchCommand('library.album', handler, 'junk', frame, refuse);
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } });
  });

  it('turns bad input into invalid_input without calling the handler', async () => {
    const handler = vi.fn(() => ok());
    const result = await dispatchCommand('library.album', handler, { albumId: 'seven' }, frame, allow);
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('turns a throw into a sentence for the person, and logs the real error', async () => {
    const boom = new Error('SQLITE_MISUSE at line 42');
    const result = await dispatchCommand(
      'settings.get',
      () => {
        throw boom;
      },
      undefined,
      frame,
      allow,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } });
    expect(JSON.stringify(result)).not.toContain('SQLITE');
    expect(log.error).toHaveBeenCalledWith(expect.any(String), boom);
  });

  it('turns a rejection into the same thing', async () => {
    const result = await dispatchCommand(
      'settings.get',
      () => Promise.reject(new Error('nope')),
      undefined,
      frame,
      allow,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } });
  });

  it('survives a sender check that throws, as reading a disposed frame does', async () => {
    const result = await dispatchCommand(
      'settings.get',
      () => ok(),
      undefined,
      frame,
      () => {
        throw new Error('Render frame was disposed');
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } });
  });
});
