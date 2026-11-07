import { describe, expect, it } from 'vitest';
import { DISCOVER_SCRIPT_EXAMPLE } from '@shared/onlineServices';
import { runScript } from '@main/online/sandbox';
import { createDiscoverAdapter } from './discoverAdapter';

type Asked = { url: string; method: string; body: string | null };

/** MusicBrainz and ListenBrainz as the example script expects them, answering by URL. */
function services(script: string | null, answer: (asked: Asked) => { status: number; body: unknown }) {
  const asked: Asked[] = [];
  const adapter = createDiscoverAdapter({
    script: () => script,
    userAgent: 'music-player test',
    run: runScript,
    fetch: (url, init) => {
      const request = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : null };
      asked.push(request);
      const { status, body } = answer(request);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    },
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
  return { adapter, asked };
}

function musicBrainzAndListenBrainz({ url, body }: Asked) {
  if (url.includes('musicbrainz.org/ws/2/artist/')) return { status: 200, body: { artists: [{ id: 'mbid-1' }] } };
  if (url.includes('musicbrainz.org/ws/2/recording/')) {
    return { status: 200, body: { recordings: [{ id: 'rec-1' }, { id: 'rec-2' }] } };
  }
  if (url.includes('/similar-artists/json')) {
    return {
      status: 200,
      body: [
        { name: 'Muse', score: 90 },
        { name: null, score: 5 },
        { name: 'Blur', score: 40 },
      ],
    };
  }
  if (url.endsWith('/similar-recordings/json') && body !== null) {
    return {
      status: 200,
      body: [
        { recording_name: 'Starlight', artist_credit_name: 'Muse', score: 12 },
        { recording_name: null, artist_credit_name: 'Gone', score: 3 },
      ],
    };
  }
  return { status: 404, body: {} };
}

describe('a Discover script', () => {
  it('works as the example shows for an artist: MusicBrainz, then ListenBrainz with what it found', async () => {
    const { adapter, asked } = services(DISCOVER_SCRIPT_EXAMPLE, musicBrainzAndListenBrainz);
    expect(await adapter.similarArtists('Radio "head"')).toEqual({
      ok: true,
      value: [
        { name: 'Muse', score: 90 },
        { name: 'Blur', score: 40 },
      ],
    });
    expect(new URL(asked[0]?.url ?? '').searchParams.get('query')).toBe('artist:"Radio \\"head\\""');
    expect(asked[1]?.url).toContain('similar-artists/json?artist_mbids=mbid-1&algorithm=');
  });

  it('works for a song too, asking ListenBrainz with a POST and a body', async () => {
    const { adapter, asked } = services(DISCOVER_SCRIPT_EXAMPLE, musicBrainzAndListenBrainz);
    expect(await adapter.similarTracks('Radiohead', 'Creep')).toEqual({
      ok: true,
      value: [{ artist: 'Muse', title: 'Starlight', score: 12 }],
    });
    expect(asked[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(asked[1]?.body ?? 'null')).toMatchObject([{ recording_mbids: ['rec-1', 'rec-2'] }]);
  });

  it('takes null as knowing nobody like them', async () => {
    const { adapter } = services(DISCOVER_SCRIPT_EXAMPLE, () => ({ status: 200, body: { artists: [] } }));
    expect(await adapter.similarArtists('Nobody')).toEqual({ ok: true, value: [] });
  });

  it('refuses a song without a title, and a score that is not a number', async () => {
    const script = `function request() { return { url: 'https://discover.example/' } }
      function parse(reply, item) {
        return { similar: [item.kind === 'song' ? { artist: 'Muse', score: 1 } : { artist: 'Muse', score: 'high' }] };
      }`;
    const { adapter } = services(script, () => ({ status: 200, body: {} }));
    for (const answer of [await adapter.similarTracks('A', 'B'), await adapter.similarArtists('A')]) {
      expect(answer.ok ? null : answer.error.message).toMatch(
        /^parse gave back something the app can't use at similar\.0/,
      );
    }
  });

  it('tests itself on one artist, saying how many it found', async () => {
    const { adapter } = services(DISCOVER_SCRIPT_EXAMPLE, musicBrainzAndListenBrainz);
    expect(await adapter.test()).toEqual({ ok: true, value: { note: 'It found 2 artists like Radiohead' } });
  });
});
