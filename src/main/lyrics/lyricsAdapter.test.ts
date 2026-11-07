import { describe, expect, it } from 'vitest';
import { LYRICS_SCRIPT_EXAMPLE } from '@shared/onlineServices';
import { runScript } from '@main/online/sandbox';
import { createLyricsAdapter } from './lyricsAdapter';
import type { LrclibTrack } from './lrclib';

const TRACK: LrclibTrack = { title: 'Plum Tree', artist: 'The Orchard', album: 'Fruit', durationMs: 300_000 };

// Twenty timed lines across the song, enough words to count as lyrics.
const SYNCED = Array.from(
  { length: 20 },
  (_, line) =>
    `[${String(Math.floor((line * 14) / 60)).padStart(2, '0')}:${String((line * 14) % 60).padStart(2, '0')}.00] plum line ${line} under the tree`,
).join('\n');
const PLAIN = SYNCED.replace(/\[[^\]]*\] /g, '');

type Reply = { status: number; body: string } | Error;

function adapter(script: string | null, replies: Reply[]) {
  const asked: { url: string; headers: Headers }[] = [];
  const lyrics = createLyricsAdapter({
    script: () => script,
    userAgent: 'music-player test',
    run: runScript,
    fetch: (url, init) => {
      asked.push({ url, headers: new Headers(init.headers) });
      const next = replies.shift();
      if (next === undefined) return Promise.reject(new Error(`No reply left for ${url}`));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(new Response(next.body, { status: next.status }));
    },
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
  return { lyrics, asked };
}

const lrclibRecord = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  body: JSON.stringify({ plainLyrics: PLAIN, syncedLyrics: SYNCED, instrumental: false, ...overrides }),
});

const messageOf = (result: { ok: boolean; error?: { message: string } }) => (result.ok ? null : result.error?.message);

describe('a lyrics script', () => {
  it('works as the example shows: asks where request says and reads what parse gives back', async () => {
    const { lyrics, asked } = adapter(LYRICS_SCRIPT_EXAMPLE, [lrclibRecord()]);
    const found = await lyrics.lookup(TRACK);

    expect(found).toMatchObject({ ok: true, value: { status: 'found', match: { via: 'script' } } });
    expect(found.ok && found.value.status === 'found' && found.value.syncedLrc).toBe(SYNCED);
    const url = new URL(asked[0]?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('https://lrclib.net/api/get');
    expect(url.searchParams.get('track_name')).toBe('Plum Tree');
    expect(url.searchParams.get('duration')).toBe('300');
    expect(asked[0]?.headers.get('Accept')).toBe('application/json');
    expect(asked[0]?.headers.get('User-Agent')).toBe('music-player test');
  });

  it('takes null, or a 404 the example reads as null, as no lyrics', async () => {
    const { lyrics } = adapter(LYRICS_SCRIPT_EXAMPLE, [{ status: 404, body: '{}' }]);
    expect(await lyrics.lookup(TRACK)).toEqual({ ok: true, value: { status: 'not_found' } });
  });

  it('judges what it finds like an LRCLIB record: too few words are no lyrics, a flag is instrumental', async () => {
    const few = adapter(LYRICS_SCRIPT_EXAMPLE, [lrclibRecord({ plainLyrics: 'la la', syncedLyrics: null })]);
    expect(await few.lyrics.lookup(TRACK)).toEqual({ ok: true, value: { status: 'not_found' } });
    const bare = adapter(LYRICS_SCRIPT_EXAMPLE, [lrclibRecord({ instrumental: true })]);
    expect(await bare.lyrics.lookup(TRACK)).toMatchObject({ ok: true, value: { status: 'instrumental' } });
  });

  it('follows a next to ask again, telling parse which ask it is, and stops after three', async () => {
    const script = `
      function request(track) { return { url: 'https://lyrics.example/search?q=' + encodeURIComponent(track.title) } }
      function parse(reply, track, ask) {
        if (ask === 1) return { next: { url: 'https://lyrics.example/song/' + JSON.parse(reply.body).id } };
        return { plain: reply.body, synced: null };
      }`;
    const { lyrics, asked } = adapter(script, [
      { status: 200, body: '{"id":7}' },
      { status: 200, body: PLAIN },
    ]);
    expect(await lyrics.lookup(TRACK)).toMatchObject({ ok: true, value: { status: 'found', plainText: PLAIN } });
    expect(asked.map(({ url }) => url)).toEqual([
      'https://lyrics.example/search?q=Plum%20Tree',
      'https://lyrics.example/song/7',
    ]);

    const endless = adapter(
      "function request() { return { url: 'https://lyrics.example/a' } }\nfunction parse() { return { next: { url: 'https://lyrics.example/b' } } }",
      [
        { status: 200, body: '' },
        { status: 200, body: '' },
        { status: 200, body: '' },
      ],
    );
    expect(messageOf(await endless.lyrics.lookup(TRACK))).toBe('Your script asked more than 3 times for one item');
    expect(endless.asked).toHaveLength(3);
  });

  it('asks nowhere a script may not: public plain http, or with a password', async () => {
    for (const url of ['http://lyrics.example/get', 'https://me:secret@lyrics.example/get']) {
      const { lyrics, asked } = adapter(`function request() { return { url: '${url}' } }\nfunction parse() {}`, []);
      expect(messageOf(await lyrics.lookup(TRACK))).toMatch(/^request asked for /);
      expect(asked).toEqual([]);
    }
  });

  it("won't let a script say who the app is, or set the connection's own headers", async () => {
    const script = `function request() { return { url: 'https://lyrics.example/', headers: { 'User-Agent': 'someone else' } } }
      function parse() { return null }`;
    const { lyrics, asked } = adapter(script, []);
    expect(messageOf(await lyrics.lookup(TRACK))).toMatch(/^request gave back something the app can't use at headers/);
    expect(asked).toEqual([]);
  });

  it('says where an answer has the wrong shape', async () => {
    const script = `function request() { return { url: 'https://lyrics.example/' } }
      function parse() { return { plain: 42, synced: null } }`;
    const { lyrics } = adapter(script, [{ status: 200, body: '' }]);
    expect(messageOf(await lyrics.lookup(TRACK))).toMatch(/^parse gave back something the app can't use/);
  });

  it("passes on a service that can't be reached as a network failure", async () => {
    const { lyrics } = adapter(LYRICS_SCRIPT_EXAMPLE, [new Error('getaddrinfo ENOTFOUND')]);
    expect(await lyrics.lookup(TRACK)).toMatchObject({
      ok: false,
      error: { code: 'network', message: "Couldn't reach lrclib.net: getaddrinfo ENOTFOUND" },
    });
  });

  it('tests itself on a sample song, saying what kind of lyrics came back but never the words', async () => {
    const { lyrics } = adapter(LYRICS_SCRIPT_EXAMPLE, [lrclibRecord()]);
    const tested = await lyrics.test();
    expect(tested).toEqual({ ok: true, value: { note: 'It found timed lyrics for Adele, Hello' } });
    expect(JSON.stringify(tested)).not.toContain('plum');

    const none = adapter(LYRICS_SCRIPT_EXAMPLE, [{ status: 404, body: '' }]);
    expect(await none.lyrics.test()).toEqual({
      ok: true,
      value: { note: 'It read the answer, which has no lyrics for Adele, Hello' },
    });
  });
});
