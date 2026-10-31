import { describe, expect, it, vi } from 'vitest';
import type { MpvClient } from './mpvClient';
import { createMpvProcess, MPV_FLAGS, mpvArgsFromEnv, type MpvProcessDeps } from './mpvProcess';
import { FakeMpv } from './testFixtures';

function setUp(overrides: Partial<MpvProcessDeps> = {}) {
  const spawned: FakeMpv[] = [];
  let time = 0;
  const calls: string[] = [];
  const clients: MpvClient[] = [];
  const log = { warn: vi.fn(), error: vi.fn() };
  const process = createMpvProcess({
    path: 'C:\\app\\mpv.exe',
    extraArgs: ['--ao=null'],
    spawn: (_path, args) => {
      const mpv = new FakeMpv(args);
      spawned.push(mpv);
      return mpv;
    },
    exists: () => true,
    now: () => time,
    log,
    onEvent: vi.fn(),
    onReady: (client) => {
      calls.push('ready');
      clients.push(client);
    },
    onLost: () => calls.push('lost'),
    onUnavailable: (problem) => calls.push(`unavailable:${problem}`),
    ...overrides,
  });
  return { process, spawned, calls, clients, log, advance: (ms: number) => (time += ms) };
}

describe('starting', () => {
  it('passes the flags, with what it was given last', () => {
    const { process, spawned } = setUp();
    process.start();
    const args = spawned[0]?.args ?? [];
    expect(args.slice(0, MPV_FLAGS.length)).toEqual(MPV_FLAGS);
    expect(args.at(-1)).toBe('--ao=null');
  });

  it('uses the plan’s flags, gapless-audio=weak among them', () => {
    expect(MPV_FLAGS).toEqual(
      expect.arrayContaining([
        '--input-ipc-client=fd://3',
        '--no-config',
        '--idle=yes',
        '--vid=no',
        '--audio-display=no',
        '--cover-art-auto=no',
        '--terminal=no',
        '--load-scripts=no',
        '--osc=no',
        '--ytdl=no',
        '--input-default-bindings=no',
        '--input-vo-keyboard=no',
        '--input-media-keys=no',
        '--media-controls=no',
        '--gapless-audio=weak',
        '--prefetch-playlist=yes',
        '--replaygain=album',
      ]),
    );
  });

  it('says it is ready with a client', () => {
    const { process, calls } = setUp();
    process.start();
    expect(calls).toEqual(['ready']);
  });

  it('is unavailable when the binary is missing, and spawns nothing', () => {
    const { process, spawned, calls } = setUp({ exists: () => false });
    process.start();
    expect(calls).toEqual(['unavailable:missing']);
    expect(spawned).toEqual([]);
  });
});

describe('a spawn that throws', () => {
  it('is unavailable, not a crash', () => {
    const { process, calls, log } = setUp({
      spawn: () => {
        throw new Error('EINVAL');
      },
    });
    process.start();
    expect(calls).toEqual(['unavailable:crashing']);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('an unexpected exit', () => {
  it('restarts', () => {
    const { process, spawned, calls, advance } = setUp();
    process.start();
    advance(60_000);
    spawned[0]?.exit();
    expect(calls).toEqual(['ready', 'lost', 'ready']);
    expect(spawned).toHaveLength(2);
  });

  it('closes the old client, so anything pending gets its answer', async () => {
    const { process, spawned, clients } = setUp();
    process.start();
    const pending = clients[0]?.command(['get_property', 'a']);
    spawned[0]?.exit();
    await expect(pending).resolves.toMatchObject({ ok: false });
  });

  it('gives up after three quick failures in a row', () => {
    const { process, spawned, calls, advance } = setUp();
    process.start();
    advance(1000);
    spawned[0]?.exit();
    advance(1000);
    spawned[1]?.exit();
    advance(1000);
    spawned[2]?.exit();
    expect(calls).toEqual(['ready', 'lost', 'ready', 'lost', 'ready', 'lost', 'unavailable:crashing']);
    expect(spawned).toHaveLength(3);
  });

  it('does not count a run that lasted', () => {
    const { process, spawned, calls, advance } = setUp();
    process.start();
    for (let run = 0; run < 6; run++) {
      advance(60_000);
      spawned[run]?.exit();
    }
    expect(calls.filter((call) => call.startsWith('unavailable'))).toEqual([]);
    expect(spawned).toHaveLength(7);
  });

  it('starts counting again after a run that lasted', () => {
    const { process, spawned, calls, advance } = setUp();
    process.start();
    advance(1000);
    spawned[0]?.exit();
    advance(1000);
    spawned[1]?.exit();
    advance(60_000);
    spawned[2]?.exit();
    advance(1000);
    spawned[3]?.exit();
    advance(1000);
    spawned[4]?.exit();
    expect(calls).not.toContain('unavailable:crashing');
  });

  it('kills mpv when it stops answering, and the exit that follows restarts it', async () => {
    vi.useFakeTimers();
    try {
      const { process, spawned, clients, advance } = setUp();
      process.start();
      const pending = clients[0]?.command(['get_property', 'a']);
      advance(60_000);
      vi.advanceTimersByTime(10_000);
      await pending;
      expect(spawned[0]?.killed).toBe(true);
      spawned[0]?.exit();
      expect(spawned).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retry', () => {
  it('starts over with the count forgotten', () => {
    const { process, spawned, calls, advance } = setUp();
    process.start();
    for (let run = 0; run < 3; run++) {
      advance(1000);
      spawned[run]?.exit();
    }
    calls.length = 0;
    process.retry();
    expect(calls).toEqual(['ready']);

    advance(1000);
    spawned[3]?.exit();
    expect(calls).toEqual(['ready', 'lost', 'ready']);
  });

  it('finds the binary if it has come back', () => {
    const exists = vi.fn(() => false);
    const { process, calls } = setUp({ exists });
    process.start();
    exists.mockReturnValue(true);
    process.retry();
    expect(calls).toEqual(['unavailable:missing', 'ready']);
  });

  it('does nothing while one is running', () => {
    const { process, spawned } = setUp();
    process.start();
    process.retry();
    expect(spawned).toHaveLength(1);
  });
});

describe('stop', () => {
  it('kills it at once and starts nothing else', () => {
    const { process, spawned, calls } = setUp();
    process.start();
    process.stop();
    expect(spawned[0]?.killed).toBe(true);
    spawned[0]?.exit();
    expect(calls).toEqual(['ready']);
    expect(spawned).toHaveLength(1);
  });
});

describe('mpvArgsFromEnv', () => {
  it('splits on spaces', () => {
    expect(mpvArgsFromEnv('--ao=pcm  --audio-format=s32 ')).toEqual(['--ao=pcm', '--audio-format=s32']);
  });

  it('is nothing when unset or empty', () => {
    expect(mpvArgsFromEnv('')).toEqual([]);
    expect(mpvArgsFromEnv('   ')).toEqual([]);
  });
});
