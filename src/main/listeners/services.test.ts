import { describe, expect, it } from 'vitest';
import { normalized } from './listeners';
import { createServiceClient, pickArtistId, pickRecordingIds } from './services';

const artist = (id: string, name: string, aliases: string[] = []) => ({
  id,
  name,
  score: 100,
  aliases: aliases.map((alias) => ({ name: alias })),
});

describe('pickArtistId', () => {
  it('takes the same name, past a higher-scoring near miss', () => {
    expect(pickArtistId('Beck', [artist('1', 'Rufus Beck'), artist('2', 'Beck')])).toBe('2');
  });

  it('takes an alias when no name matches', () => {
    expect(
      pickArtistId('Kanye West', [artist('1', 'Kanye West Tribute Band'), artist('2', 'Ye', ['Kanye West'])]),
    ).toBe('2');
  });

  it('prefers a name to an alias', () => {
    expect(pickArtistId('X', [artist('1', 'Y', ['X']), artist('2', 'X')])).toBe('2');
  });

  it('would rather have no answer than someone else', () => {
    expect(pickArtistId('Room Eleven', [artist('1', 'Room 11')])).toBeNull();
  });
});

describe('pickRecordingIds', () => {
  it('keeps every version of the title, and only that title', () => {
    const recordings = [
      { id: '1', title: 'War' },
      { id: '2', title: 'War (live)' },
      { id: '3', title: 'War Pigs' },
    ];
    expect(pickRecordingIds('War', recordings)).toEqual(['1', '2']);
  });
});

describe('normalized', () => {
  it('scores against the best in the answer, one per key', () => {
    const answers = [
      { key: 'a', score: 50 },
      { key: 'b', score: 100 },
      { key: 'a', score: 25 },
    ];
    const scored = normalized(
      answers,
      ({ key }) => key,
      ({ score }) => score,
    );
    expect(scored.map(({ key, score }) => [key, score])).toEqual([
      ['a', 0.5],
      ['b', 1],
    ]);
  });

  it('copes with an answer of nothing', () => {
    expect(normalized([], String, Number)).toEqual([]);
  });
});

describe('the client', () => {
  type Where = { address: () => string; isOn: () => boolean };
  const radiohead = { artists: [{ id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711', name: 'Radiohead', score: 100 }] };

  function serve(replies: Response[], where: Partial<Record<'musicbrainz' | 'listenbrainz', Where>> = {}) {
    const urls: string[] = [];
    const client = createServiceClient('music-player test', {
      fetch: (url) => {
        urls.push(url);
        const next = replies.shift();
        return next === undefined ? Promise.reject(new Error(`No reply left for ${url}`)) : Promise.resolve(next);
      },
      sleep: () => Promise.resolve(),
      now: () => 0,
      random: () => 0.5,
      ...where,
    });
    return { client, urls };
  }
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init);

  it('asks each service at the address set for it', async () => {
    const { client, urls } = serve([json(radiohead)], {
      musicbrainz: { address: () => 'https://mb.example/ws/2', isOn: () => true },
    });
    await client.artistId('Radiohead');
    expect(urls[0]?.startsWith('https://mb.example/ws/2/artist/?query=')).toBe(true);
  });

  it('asks nothing of a service turned off', async () => {
    const { client, urls } = serve([], { listenbrainz: { address: () => 'https://x.example', isOn: () => false } });
    expect(await client.similarArtists('some-id')).toMatchObject({ ok: false, error: { code: 'service_off' } });
    expect(urls).toEqual([]);
  });

  it("tests each one against an answer it can read, and says when it can't", async () => {
    const good = serve([json(radiohead), json([{ name: 'Muse', score: 9 }])]);
    expect((await good.client.test('musicbrainz')).ok).toBe(true);
    expect((await good.client.test('listenbrainz')).ok).toBe(true);

    const odd = serve([json({ hello: 'world' })]);
    const tested = await odd.client.test('musicbrainz');
    expect(tested.ok ? null : tested.error.message).toContain('not the way MusicBrainz does');
  });

  it('tests once, with no retries, whether or not the service is on', async () => {
    const { client, urls } = serve([json({}, { status: 503 })], {
      musicbrainz: { address: () => 'https://mb.example/ws/2', isOn: () => false },
    });
    expect(await client.test('musicbrainz')).toMatchObject({ ok: false, error: { code: 'network' } });
    expect(urls).toHaveLength(1);
  });
});
