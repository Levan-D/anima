import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMpvClient, type MpvConnection, type MpvEvent } from './mpvClient';

function setUp(options: { timeoutMs?: number } = {}) {
  const written: { command: unknown[]; request_id: number }[] = [];
  let receive: (chunk: Buffer) => void = () => {};
  let close: () => void = () => {};
  const destroy = vi.fn();
  const connection: MpvConnection = {
    write: (line) => written.push(JSON.parse(line) as (typeof written)[number]),
    onData: (listener) => {
      receive = listener;
    },
    onClose: (listener) => {
      close = listener;
    },
    destroy,
  };
  const events: MpvEvent[] = [];
  const onHung = vi.fn();
  const onMalformed = vi.fn();
  const client = createMpvClient(connection, {
    onEvent: (event) => events.push(event),
    onHung,
    onMalformed,
    ...options,
  });
  return {
    client,
    written,
    events,
    onHung,
    onMalformed,
    destroy,
    receive: (text: string) => receive(Buffer.from(text)),
    receiveBytes: (bytes: Buffer) => receive(bytes),
    closeConnection: () => close(),
    reply: (id: number, data?: unknown, error = 'success') =>
      receive(Buffer.from(`${JSON.stringify({ request_id: id, error, ...(data === undefined ? {} : { data }) })}\n`)),
  };
}

describe('requests', () => {
  it('sends one JSON line per command, with its own id', () => {
    const { client, written } = setUp();
    void client.command(['set_property', 'pause', true]);
    void client.command(['loadfile', 'D:\\Music\\Björk\\Jóga.flac', 'replace', -1, 'start=1.000']);
    expect(written).toEqual([
      { command: ['set_property', 'pause', true], request_id: 1 },
      { command: ['loadfile', 'D:\\Music\\Björk\\Jóga.flac', 'replace', -1, 'start=1.000'], request_id: 2 },
    ]);
  });

  it('writes one line, ending in a newline, with none inside it', () => {
    const lines: string[] = [];
    const client = createMpvClient(
      { write: (line) => lines.push(line), onData: () => {}, onClose: () => {}, destroy: () => {} },
      { onEvent: () => {}, onHung: () => {}, onMalformed: () => {} },
    );
    void client.command(['show-text', 'two\nlines']);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(lines[0]?.slice(0, -1)).not.toContain('\n');
  });

  it('answers with the data', async () => {
    const { client, reply } = setUp();
    const answer = client.command(['get_property', 'time-pos']);
    reply(1, 12.5);
    await expect(answer).resolves.toEqual({ ok: true, value: 12.5 });
  });

  it('answers null when a success has no data', async () => {
    const { client, reply } = setUp();
    const answer = client.command(['set_property', 'pause', true]);
    reply(1);
    await expect(answer).resolves.toEqual({ ok: true, value: null });
  });

  it('matches replies that come back in another order', async () => {
    const { client, reply } = setUp();
    const first = client.command(['get_property', 'a']);
    const second = client.command(['get_property', 'b']);
    const third = client.command(['get_property', 'c']);
    reply(3, 'three');
    reply(1, 'one');
    reply(2, 'two');
    await expect(first).resolves.toEqual({ ok: true, value: 'one' });
    await expect(second).resolves.toEqual({ ok: true, value: 'two' });
    await expect(third).resolves.toEqual({ ok: true, value: 'three' });
  });

  it('turns a refusal into an error result', async () => {
    const { client, reply } = setUp();
    const answer = client.command(['get_property', 'nope']);
    reply(1, undefined, 'property not found');
    await expect(answer).resolves.toMatchObject({ ok: false, error: { message: 'property not found' } });
  });

  it('ignores a reply nobody is waiting for', () => {
    const { reply, onMalformed } = setUp();
    reply(99, 'late');
    expect(onMalformed).not.toHaveBeenCalled();
  });
});

describe('reading the stream', () => {
  it('puts a line back together across chunks', async () => {
    const { client, receive } = setUp();
    const answer = client.command(['get_property', 'time-pos']);
    receive('{"request_id":1,"err');
    receive('or":"success","da');
    receive('ta":3.5}\n');
    await expect(answer).resolves.toEqual({ ok: true, value: 3.5 });
  });

  it('takes several lines from one chunk, with a piece of the next left over', () => {
    const { events, receive } = setUp();
    receive('{"event":"file-loaded"}\n{"event":"start-file","playlist_entry_id":1}\n{"event":"end-fi');
    expect(events).toEqual([{ type: 'file-loaded' }, { type: 'start-file', entryId: 1 }]);
    receive('le","reason":"eof","playlist_entry_id":1}\n');
    expect(events[2]).toEqual({ type: 'end-file', entryId: 1, reason: 'eof', fileError: null });
  });

  it('puts a character back together when a chunk cuts it in half', async () => {
    const { client, receiveBytes } = setUp();
    const answer = client.command(['get_property', 'path']);
    const line = Buffer.from('{"request_id":1,"error":"success","data":"Björk 東京"}\n');
    const split = line.indexOf(Buffer.from('ö')) + 1;
    const splitAgain = line.indexOf(Buffer.from('東')) + 2;
    receiveBytes(line.subarray(0, split));
    receiveBytes(line.subarray(split, splitAgain));
    receiveBytes(line.subarray(splitAgain));
    await expect(answer).resolves.toEqual({ ok: true, value: 'Björk 東京' });
  });

  it('carries on after a line that is not JSON, and says so', () => {
    const { events, receive, onMalformed } = setUp();
    receive('this is not json\n{"event":"file-loaded"}\n');
    expect(onMalformed).toHaveBeenCalledWith('this is not json');
    expect(events).toEqual([{ type: 'file-loaded' }]);
  });

  it('survives invalid UTF-8, which mpv can send', () => {
    const { events, receiveBytes, onMalformed } = setUp();
    receiveBytes(
      Buffer.concat([Buffer.from('{"event":"file-loaded","x":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}\n')]),
    );
    expect(events).toEqual([{ type: 'file-loaded' }]);
    expect(onMalformed).not.toHaveBeenCalled();
  });

  it('calls valid JSON of the wrong shape malformed', () => {
    const { receive, onMalformed } = setUp();
    receive('{"something":"else"}\n[1,2]\n');
    expect(onMalformed).toHaveBeenCalledTimes(2);
  });

  it('skips blank lines', () => {
    const { events, receive, onMalformed } = setUp();
    receive('\n  \n');
    expect(events).toEqual([]);
    expect(onMalformed).not.toHaveBeenCalled();
  });
});

describe('events', () => {
  it('turns what it needs into clean shapes', () => {
    const { events, receive } = setUp();
    receive(
      [
        '{"event":"start-file","playlist_entry_id":4}',
        '{"event":"end-file","reason":"error","playlist_entry_id":4,"file_error":"loading failed"}',
        '{"event":"property-change","id":1,"name":"time-pos","data":1.5}',
        '{"event":"property-change","id":2,"name":"audio-params"}',
        '',
      ].join('\n'),
    );
    expect(events).toEqual([
      { type: 'start-file', entryId: 4 },
      { type: 'end-file', entryId: 4, reason: 'error', fileError: 'loading failed' },
      { type: 'property-change', name: 'time-pos', data: 1.5 },
      { type: 'property-change', name: 'audio-params', data: null },
    ]);
  });

  it('passes over events it has no use for, without complaint', () => {
    const { events, receive, onMalformed } = setUp();
    receive('{"event":"audio-reconfig"}\n{"event":"idle"}\n{"event":"playback-restart"}\n');
    expect(events).toEqual([]);
    expect(onMalformed).not.toHaveBeenCalled();
  });

  it('drops an event it needs that has the wrong shape', () => {
    const { events, receive } = setUp();
    receive('{"event":"start-file","playlist_entry_id":"four"}\n');
    expect(events).toEqual([]);
  });

  it('calls a reason it has never heard of unknown', () => {
    const { events, receive } = setUp();
    receive('{"event":"end-file","reason":"aliens","playlist_entry_id":1}\n');
    expect(events[0]).toMatchObject({ reason: 'unknown' });
  });
});

describe('closing', () => {
  it('answers everything pending with an error when the connection closes', async () => {
    const { client, closeConnection } = setUp();
    const first = client.command(['get_property', 'a']);
    const second = client.command(['get_property', 'b']);
    closeConnection();
    await expect(first).resolves.toMatchObject({ ok: false });
    await expect(second).resolves.toMatchObject({ ok: false });
  });

  it('answers at once afterwards, and writes nothing', async () => {
    const { client, closeConnection, written } = setUp();
    closeConnection();
    await expect(client.command(['stop'])).resolves.toMatchObject({ ok: false });
    expect(written).toEqual([]);
  });

  it('says whether it is open', () => {
    const { client, closeConnection } = setUp();
    expect(client.isOpen()).toBe(true);
    closeConnection();
    expect(client.isOpen()).toBe(false);
  });

  it('closes the connection when told to', async () => {
    const { client, destroy } = setUp();
    const pending = client.command(['get_property', 'a']);
    client.close();
    expect(destroy).toHaveBeenCalled();
    await expect(pending).resolves.toMatchObject({ ok: false });
  });
});

describe('timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a request nobody answers, and says the connection is hung', async () => {
    const { client, onHung } = setUp({ timeoutMs: 1000 });
    const answer = client.command(['get_property', 'a']);
    vi.advanceTimersByTime(999);
    expect(onHung).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await expect(answer).resolves.toMatchObject({ ok: false });
    expect(onHung).toHaveBeenCalledOnce();
    expect(client.isOpen()).toBe(false);
  });

  it('forgets the timeout once it has its answer', async () => {
    const { client, reply, onHung } = setUp({ timeoutMs: 1000 });
    const answer = client.command(['get_property', 'a']);
    reply(1, 'fine');
    await answer;
    vi.advanceTimersByTime(5000);
    expect(onHung).not.toHaveBeenCalled();
  });

  it('forgets the timeouts when it closes', async () => {
    const { client, closeConnection, onHung } = setUp({ timeoutMs: 1000 });
    const answer = client.command(['get_property', 'a']);
    closeConnection();
    await answer;
    vi.advanceTimersByTime(5000);
    expect(onHung).not.toHaveBeenCalled();
  });
});
